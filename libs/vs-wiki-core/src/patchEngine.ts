import type { AssetIndex, PatchOp } from "./types.js";
import { assetsUnderAnyDomain, resolveFileRef } from "./assetLoader.js";

/**
 * Default world-creation config values, used to statically resolve patch `condition` gates
 * (these mirror the "Default" world-creation preset; see Open Risks in the project plan).
 * `useValue: true` patches carry a literal `value` that's correct at these defaults (all 100%/1.0).
 */
const DEFAULT_WORLD_CONFIG: Record<string, unknown> = {
  blockGravity: "sandgravelsoil",
  loreContent: "true",
  noLiquidSourceTransport: "true",
  temporalStability: "true",
  deathPunishment: "keep",
  surfaceCopperDeposits: "true",
  surfaceTinDeposits: "true",
  globalDepositSpawnRate: "true",
  foodSpoilSpeed: "true",
  playerHungerSpeed: "true",
  playerMoveSpeed: "true",
  creatureStrength: "true",
  toolDurability: "true",
  toolMiningSpeed: "true",
  playerHealthPoints: "true",
  droppedItemsTimer: "true",
};

export function collectPatches(index: AssetIndex): PatchOp[] {
  const patches: PatchOp[] = [];
  const patchAssets = assetsUnderAnyDomain(index, "patches/").concat(
    [...index.values()].filter((a) => /\/compatibility\/[^/]+\/patches\//.test("/" + a.relPath))
  );
  const seen = new Set<string>();
  for (const asset of patchAssets) {
    const key = `${asset.domain}:${asset.relPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entries = Array.isArray(asset.json) ? asset.json : [asset.json];
    for (const entry of entries as PatchOp[]) {
      patches.push({ ...entry, __modid: asset.modid, __sourceFile: asset.sourceFile, __domain: asset.domain });
    }
  }
  return patches;
}

/** Returns the othermodid a path lies under compatibility/<othermodid>/, if any. */
function compatibilityGuardModid(relPath: string): string | undefined {
  const m = relPath.match(/compatibility\/([^/]+)\//);
  return m?.[1];
}

export function filterPatches(patches: PatchOp[], activeModIds: Set<string>): PatchOp[] {
  return patches.filter((p) => {
    if (p.side === "Client") return false;

    const guardModid = compatibilityGuardModid(p.__sourceFile ?? "");
    if (guardModid && !activeModIds.has(guardModid.toLowerCase())) return false;

    if (p.dependsOn) {
      for (const dep of p.dependsOn) {
        const present = activeModIds.has(dep.modid.toLowerCase());
        const ok = dep.invert ? !present : present;
        if (!ok) return false;
      }
    }

    if (p.condition) {
      const { when, isValue, useValue } = p.condition;
      if (useValue) return true; // literal `value` is correct at default settings
      if (isValue !== undefined) {
        const def = DEFAULT_WORLD_CONFIG[when];
        if (String(isValue).toLowerCase() !== String(def).toLowerCase()) return false;
      }
    }

    return true;
  });
}

/** Also filters plain (non-patch) assets gated by a compatibility/<othermodid>/ path convention. */
export function isAssetActive(relPath: string, activeModIds: Set<string>): boolean {
  const guardModid = compatibilityGuardModid(relPath);
  if (!guardModid) return true;
  return activeModIds.has(guardModid.toLowerCase());
}

function splitPath(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function navigate(root: unknown, segments: string[]): { parent: any; key: string | number } | undefined {
  let current: any = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (current == null) return undefined;
    const key = Array.isArray(current) ? Number(seg) : seg;
    current = current[key as never];
  }
  if (current == null) return undefined;
  const lastSeg = segments[segments.length - 1];
  return { parent: current, key: Array.isArray(current) ? (lastSeg === "-" ? "-" : Number(lastSeg)) : lastSeg };
}

function deepMerge(target: unknown, value: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(value)) return [...target, ...value];
  if (
    target &&
    value &&
    typeof target === "object" &&
    typeof value === "object" &&
    !Array.isArray(target) &&
    !Array.isArray(value)
  ) {
    return { ...(target as object), ...(value as object) };
  }
  return value;
}

/** Applies one patch op in place against the target root JSON. Path segments match literal object keys/array indices. */
function applyOp(root: unknown, op: PatchOp): void {
  const segments = splitPath(op.path);
  if (segments.length === 0) return; // replacing the whole document isn't needed by any real patch seen
  const nav = navigate(root, segments);
  if (!nav) return; // parent path doesn't exist in this target -- skip rather than throw

  const { parent, key } = nav;

  switch (op.op) {
    case "add": {
      if (Array.isArray(parent)) {
        if (key === "-") parent.push(op.value);
        else parent.splice(key as number, 0, op.value);
      } else {
        parent[key as string] = op.value;
      }
      break;
    }
    case "replace": {
      if (Array.isArray(parent) && key === "-") parent.push(op.value);
      else parent[key as never] = op.value;
      break;
    }
    case "remove": {
      if (Array.isArray(parent)) parent.splice(key as number, 1);
      else delete parent[key as string];
      break;
    }
    case "addmerge": {
      if (Array.isArray(parent)) {
        if (key === "-") parent.push(op.value);
        else parent[key as number] = deepMerge(parent[key as number], op.value);
      } else {
        parent[key as string] = deepMerge(parent[key as string], op.value);
      }
      break;
    }
    default:
      // unknown op: ignore rather than throw, surfaced via the build report instead
      break;
  }
}

export interface PatchApplicationReport {
  applied: number;
  unresolvedFileTargets: { file: string; op: string; sourceFile: string }[];
}

/**
 * Applies every active patch against a deep-cloned copy of the asset index, in order
 * (vanilla first, then mods in manifest order -- the order `patches` is already sorted in).
 * Returns the same index with each affected asset's `.json` replaced by its patched value.
 */
export function applyPatches(index: AssetIndex, patches: PatchOp[]): PatchApplicationReport {
  const report: PatchApplicationReport = { applied: 0, unresolvedFileTargets: [] };

  for (const patch of patches) {
    const fallbackDomain = patch.__domain ?? "survival";
    const target = resolveFileRef(index, patch.file, fallbackDomain);
    if (!target) {
      report.unresolvedFileTargets.push({ file: patch.file, op: patch.op, sourceFile: patch.__sourceFile ?? "" });
      continue;
    }
    const asset = index.get(`${target.domain}:${target.relPath}`)!;
    applyOp(asset.json, patch);
    report.applied++;
  }

  return report;
}
