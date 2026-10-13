import { readFileSync } from "node:fs";
import type { AssetIndex, TapestryInstance, TapestryOutcome } from "../types.js";
import type { LangResolver } from "../lang.js";
import type { DecodeStats, SchematicFile } from "../schematicHeader.js";
import { readSchematicBlockCodes, recordDecodeFailure } from "../schematicHeader.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";
// Canonical decode module lives under site/assets/ (not src/ingest/) so it stays directly
// <script>-loadable for a future browser-side schematic viewer with zero changes -- see
// CLAUDE.md/README for why. This is a plain relative import across that boundary.
import { decodeBlockEntity } from "../../../site/assets/schematicDecode.js";

type TapestryPrefix = "tapestry" | "wallcarving";

function stripTrailingDigits(type: string): string {
  // Port of BlockTapestry.GetBaseCode: strips up to 2 trailing digit characters (the piece-number
  // suffix on multi-tile tapestries, e.g. "temporality2" -> "temporality", "schematic-a11" ->
  // "schematic-a" since both trailing chars are digits).
  if (type.length === 0) return type;
  let cut = 0;
  if (/[0-9]/.test(type[type.length - 1])) cut++;
  if (cut === 1 && /[0-9]/.test(type[type.length - 2])) cut++;
  return cut > 0 ? type.slice(0, type.length - cut) : type;
}

interface PrefixConfig {
  loreChapterIds: Record<string, number>;
  sizes: Record<string, string>; // e.g. "nightfall" -> "3x1" -- the multi-tile shape, shared by every member of a reroll group (rerolling can't change how many blocks a placement occupies)
  groups: string[][];
  loreBookCode: string; // "tapestry" | "wallcarving" -- the config/lore/<code>.json this ties to
}

function loadPrefixConfig(index: AssetIndex, prefix: TapestryPrefix): PrefixConfig | undefined {
  const relPath = prefix === "tapestry" ? "blocktypes/cloth/tapestry.json" : "blocktypes/stone/wallcarving.json";
  const asset = assetsUnderAnyDomain(index, relPath)[0];
  if (!asset) return undefined;
  const attrs = (asset.json as any)?.attributes;
  const groupsKey = prefix === "tapestry" ? "tapestryGroups" : "wallcarvingGroups";
  if (!attrs?.loreChapterIds || !Array.isArray(attrs[groupsKey])) return undefined;
  return { loreChapterIds: attrs.loreChapterIds, sizes: attrs.sizes ?? {}, groups: attrs[groupsKey], loreBookCode: prefix };
}

function resolveOutcome(lang: LangResolver, domain: string, prefix: TapestryPrefix, config: PrefixConfig, type: string): TapestryOutcome {
  const baseCode = stripTrailingDigits(type);
  const chapterId = config.loreChapterIds[baseCode];
  const displayName = lang.tapestryName(domain, prefix, type) ?? type;
  return {
    rawType: type,
    baseCode,
    displayName,
    loreChapterId: chapterId !== undefined && chapterId >= 0 ? chapterId : undefined,
    size: config.sizes[baseCode],
  };
}

/**
 * Decodes tapestry/wallcarving block-entity instances out of worldgen schematics' `BlockEntities`
 * data (see `site/assets/schematicDecode.js`), scoped to exactly the schematic files
 * `schematicToStructure` already resolves (i.e. ones actually referenced by world generation --
 * never a blanket walk of every `.json` under `worldgen/schematics/`). For each instance, resolves
 * every real possible outcome (not just the schematic's stored sample) by finding which
 * `tapestryGroups`/`wallcarvingGroups` entry the stored "type" belongs to -- see
 * `BlockTapestry.OnLoadCollectibleMappings` in the game source for why that reroll happens.
 */
export function extractTapestryInstances(
  schematicsByDomain: Map<string, SchematicFile[]>,
  schematicToStructure: Map<string, Set<string>>,
  index: AssetIndex,
  lang: LangResolver,
  stats?: DecodeStats
): TapestryInstance[] {
  const configs: Record<TapestryPrefix, PrefixConfig | undefined> = {
    tapestry: loadPrefixConfig(index, "tapestry"),
    wallcarving: loadPrefixConfig(index, "wallcarving"),
  };
  if (!configs.tapestry && !configs.wallcarving) return [];

  // schematicKey ("domain:worldgen/schematics/<relPath>.json") -> full filesystem path, so we can
  // actually read the files schematicToStructure's keys refer to (it only carries the key, not
  // enough to open the file -- mirrors the lookup buildBlockCodeToSchematicIndex does internally).
  const fullPathByKey = new Map<string, string>();
  for (const [domain, files] of schematicsByDomain) {
    for (const file of files) {
      fullPathByKey.set(`${domain}:worldgen/schematics/${file.relPath}.json`, file.fullPath);
    }
  }

  const out: TapestryInstance[] = [];

  for (const [schematicKey, structureIds] of schematicToStructure) {
    const fullPath = fullPathByKey.get(schematicKey);
    if (!fullPath) continue;

    // Cheap pre-filter: skip the (large majority of) schematics with no tapestry/wallcarving code
    // at all, before paying for a full JSON.parse of potentially-large voxel arrays.
    const hasCandidate = readSchematicBlockCodes(fullPath).some((c) => {
      const bare = c.includes(":") ? c.slice(c.indexOf(":") + 1) : c;
      return bare.startsWith("tapestry-") || bare.startsWith("wallcarving-");
    });
    if (!hasCandidate) continue;

    const domain = schematicKey.slice(0, schematicKey.indexOf(":"));
    let data: { BlockEntities?: Record<string, string> };
    try {
      data = JSON.parse(readFileSync(fullPath, "utf8"));
    } catch {
      if (stats) stats.unreadable++;
      continue; // malformed/unreadable -- skip rather than fail the whole ingest
    }
    const blockEntities = data.BlockEntities;
    if (!blockEntities) continue;
    if (stats) stats.schematics++;

    for (const [packedIndex, blob] of Object.entries(blockEntities)) {
      if (stats) stats.entities++;
      let decoded: { blockCode?: string; type?: string };
      try {
        decoded = decodeBlockEntity(blob);
      } catch (e) {
        recordDecodeFailure(stats, `${schematicKey} #${packedIndex}`, e);
        continue; // skip the one blob rather than fail the whole ingest; counted in `stats`
      }
      const blockCode = decoded.blockCode;
      const type = decoded.type;
      if (!blockCode || typeof type !== "string") continue;

      const prefix: TapestryPrefix | undefined = blockCode.startsWith("tapestry-")
        ? "tapestry"
        : blockCode.startsWith("wallcarving-")
          ? "wallcarving"
          : undefined;
      if (!prefix) continue;
      const config = configs[prefix];
      if (!config) continue;

      const group = config.groups.find((g) => g.includes(type));
      const storedBaseCode = stripTrailingDigits(type);
      const outcomes = (group ?? [type]).map((member) => resolveOutcome(lang, domain, prefix, config, member));

      for (const structureId of structureIds) {
        out.push({
          id: `${structureId}#${schematicKey}#${packedIndex}`,
          structureId,
          blockCode,
          storedBaseCode,
          rerolls: (group ?? [type]).length > 1,
          outcomes,
        });
      }
    }
  }

  return out;
}
