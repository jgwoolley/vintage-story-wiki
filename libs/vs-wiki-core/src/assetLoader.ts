import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import JSON5 from "json5";
import type { AssetIndex, AssetSource, LoadedAsset } from "./types.js";

function walkJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      if (entry === "schematics") continue; // voxel data is huge and handled separately (see schematicHeader.ts)
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (entry.toLowerCase().endsWith(".json")) {
        out.push(full);
      }
    }
  }
  return out;
}

export interface LoadReport {
  filesLoaded: number;
  parseErrors: { file: string; error: string }[];
  overrides: { key: string; keptFrom: string; droppedFrom: string }[];
}

/** Walks every AssetSource's domain folder and builds a flat domain:relPath -> asset index. */
export function loadAssets(sources: AssetSource[]): { index: AssetIndex; report: LoadReport } {
  const index: AssetIndex = new Map();
  const report: LoadReport = { filesLoaded: 0, parseErrors: [], overrides: [] };

  for (const source of sources) {
    const files = walkJsonFiles(source.rootDir);
    for (const file of files) {
      const relPath = relative(source.rootDir, file).split(sep).join("/");
      let json: unknown;
      try {
        json = JSON5.parse(readFileSync(file, "utf8"));
      } catch (err) {
        report.parseErrors.push({ file, error: String(err) });
        continue;
      }
      report.filesLoaded++;
      const key = `${source.domain}:${relPath}`;
      const asset: LoadedAsset = { domain: source.domain, relPath, modid: source.modid, sourceFile: file, json };
      const existing = index.get(key);
      if (existing) {
        report.overrides.push({ key, keptFrom: source.modid, droppedFrom: existing.modid });
      }
      index.set(key, asset); // last-loaded wins
    }
  }

  return { index, report };
}

/** Finds all JSON assets whose relPath starts with the given category prefix (e.g. "recipes/grid/"). */
export function assetsUnder(index: AssetIndex, domain: string, prefix: string): LoadedAsset[] {
  const out: LoadedAsset[] = [];
  for (const asset of index.values()) {
    if (asset.domain === domain && asset.relPath.startsWith(prefix)) out.push(asset);
  }
  return out;
}

/** Finds all JSON assets anywhere whose relPath starts with the given category prefix, across all domains. */
export function assetsUnderAnyDomain(index: AssetIndex, prefix: string): LoadedAsset[] {
  const out: LoadedAsset[] = [];
  for (const asset of index.values()) {
    if (asset.relPath.startsWith(prefix)) out.push(asset);
  }
  return out;
}

/**
 * Resolves a patch/schematic "file" reference like "game:worldgen/structures.json" or a bare
 * "worldgen/deposits.json" (implicitly relative to `fallbackDomain`, the referencing file's own domain)
 * into a concrete domain:relPath, tolerating the "game:" alias (which in practice has no matching
 * files for most categories and falls back across survival/creative).
 */
export function resolveFileRef(
  index: AssetIndex,
  fileRef: string,
  fallbackDomain: string
): { domain: string; relPath: string } | undefined {
  let domain: string;
  let relPath: string;
  if (fileRef.includes(":")) {
    [domain, relPath] = fileRef.split(/:(.+)/).filter((s) => s !== undefined) as [string, string];
  } else {
    domain = fallbackDomain;
    relPath = fileRef;
  }

  // Core vanilla domains alias/overlap loosely in practice (e.g. a bare, unprefixed ref from a
  // survival/ patch can target a file that actually lives in game/), so always fall back across
  // all three; a non-core domain (a mod's own) is tried as-is only.
  const coreDomains = ["game", "survival", "creative"];
  const tryDomains = coreDomains.includes(domain) ? coreDomains : [domain];
  // Some mod patches omit the .json extension on their `file` target.
  const relPathCandidates = relPath.endsWith(".json") ? [relPath] : [relPath, `${relPath}.json`];

  for (const d of tryDomains) {
    for (const r of relPathCandidates) {
      if (index.has(`${d}:${r}`)) return { domain: d, relPath: r };
    }
  }
  return undefined;
}
