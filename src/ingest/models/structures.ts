import type { AssetIndex, NormalizedStructure, SchematicSummary, StructureKind } from "../types.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";
import { readSchematicHeader, type SchematicFile } from "../schematicHeader.js";

// "MinSpawnDistance" is deliberately excluded here -- it's already promoted to the top-level
// `minSpawnDistance` field below, so including it here would render the same value twice.
const RESTRICTION_KEYS = [
  "minTemp",
  "maxTemp",
  "minRain",
  "maxRain",
  "minForestDensity",
  "maxForestDensity",
  "requireLandform",
  "landformRadius",
  "forceTemperature",
  "MaxBelowSealevel",
  "maxYDiff",
  "dependsOnStructure",
  "minSpawnDistX",
  "maxSpawnDistX",
  "minSpawnDistZ",
  "maxSpawnDistZ",
];

function globSegmentsMatch(globPath: string, relPath: string): boolean {
  const globSegs = globPath.split("/");
  const pathSegs = relPath.split("/");
  if (globSegs.length !== pathSegs.length) return false;
  return globSegs.every((seg, i) => {
    if (seg === "*") return true;
    const escaped = seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(pathSegs[i]);
  });
}

function resolveSchematicGlob(
  schematicsByDomain: Map<string, SchematicFile[]>,
  domain: string,
  globPath: string
): SchematicSummary["resolvedFiles"] {
  const globNoExt = globPath.replace(/\.json$/, "");
  const candidates = schematicsByDomain.get(domain) ?? [];
  const resolved: SchematicSummary["resolvedFiles"] = [];
  for (const file of candidates) {
    if (!globSegmentsMatch(globNoExt, file.relPath)) continue;
    const header = readSchematicHeader(file.fullPath);
    resolved.push({ path: `worldgen/schematics/${file.relPath}.json`, ...header });
  }
  return resolved;
}

function extractRestrictions(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of RESTRICTION_KEYS) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  return out;
}

function buildSchematics(
  schematicsByDomain: Map<string, SchematicFile[]>,
  domain: string,
  raw: any
): SchematicSummary[] {
  const rawList: (string | { path: string; weight?: number; minQuantity?: number; maxQuantity?: number })[] =
    raw.schematics ?? [];
  return rawList.map((entry) => {
    const globPath = typeof entry === "string" ? entry : entry.path;
    return {
      globPath,
      resolvedFiles: resolveSchematicGlob(schematicsByDomain, domain, globPath),
      weight: typeof entry === "object" ? entry.weight : undefined,
      minQuantity: typeof entry === "object" ? entry.minQuantity : undefined,
      maxQuantity: typeof entry === "object" ? entry.maxQuantity : undefined,
    };
  });
}

function extractFromRegistry(
  index: AssetIndex,
  schematicsByDomain: Map<string, SchematicFile[]>,
  relPath: string,
  listKey: string,
  kind: StructureKind
): NormalizedStructure[] {
  const out: NormalizedStructure[] = [];
  for (const asset of assetsUnderAnyDomain(index, relPath)) {
    const json = asset.json as any;
    const list: any[] = json[listKey] ?? [];
    list.forEach((entry, i) => {
      out.push({
        id: `${asset.domain}:${kind}/${entry.code ?? "unnamed"}#${i}`,
        kind,
        code: entry.code ?? `${relPath}#${i}`,
        name: entry.name,
        domain: asset.domain,
        sourceMod: asset.modid,
        group: entry.group,
        chance: entry.chance,
        placement: entry.placement,
        minSpawnDistance: entry.MinSpawnDistance ?? entry.minSpawnDistance,
        minGroupDistance: entry.minGroupDistance,
        restrictions: extractRestrictions(entry),
        schematics: buildSchematics(schematicsByDomain, asset.domain, entry),
        raw: entry,
      });
    });
  }
  return out;
}

function extractHookGenerated(
  index: AssetIndex,
  schematicsByDomain: Map<string, SchematicFile[]>
): NormalizedStructure[] {
  const out: NormalizedStructure[] = [];
  for (const asset of assetsUnderAnyDomain(index, "worldgen/hookgeneratedstructures/")) {
    const json = asset.json as any;
    const mainElements: any[] = json.mainElements ?? [];
    const endElements = Object.values(json.endElements ?? {}) as any[];
    const allPaths = [...mainElements, ...endElements].map((e) => e.path).filter(Boolean);

    const resolvedFiles: SchematicSummary["resolvedFiles"] = [];
    const candidates = schematicsByDomain.get(asset.domain) ?? [];
    for (const rawPath of allPaths) {
      const normalized = rawPath.replace(/^worldgen\//, "").replace(/\.json$/, "");
      const relAttempt = normalized.startsWith("schematics/") ? normalized.slice("schematics/".length) : normalized;
      const match = candidates.find((f) => f.relPath === relAttempt);
      if (match) {
        resolvedFiles.push({ path: `worldgen/schematics/${match.relPath}.json`, ...readSchematicHeader(match.fullPath) });
      }
    }

    out.push({
      id: `${asset.domain}:hookgenerated/${json.code ?? asset.relPath}`,
      kind: "hookgenerated",
      code: json.code ?? asset.relPath,
      domain: asset.domain,
      sourceMod: asset.modid,
      group: json.group,
      restrictions: {},
      schematics: [{ globPath: allPaths.join(", "), resolvedFiles }],
      raw: json,
    });
  }
  return out;
}

export function extractStructures(
  index: AssetIndex,
  schematicsByDomain: Map<string, SchematicFile[]>
): NormalizedStructure[] {
  return [
    ...extractFromRegistry(index, schematicsByDomain, "worldgen/structures.json", "structures", "structure"),
    ...extractFromRegistry(index, schematicsByDomain, "worldgen/villages.json", "villageTypes", "village"),
    ...extractFromRegistry(index, schematicsByDomain, "worldgen/storystructures.json", "structures", "storystructure"),
    ...extractHookGenerated(index, schematicsByDomain),
  ];
}
