import { readFileSync } from "node:fs";
import type { ClutterType, NormalizedStructure } from "../types.js";
import type { LangResolver } from "../lang.js";
import type { DecodeStats, SchematicFile } from "../schematicHeader.js";
import { readSchematicBlockCodes, recordDecodeFailure } from "../schematicHeader.js";
// Same canonical (browser-loadable) decoder the tapestry model uses -- see tapestryInstances.ts.
import { decodeBlockEntity } from "../../../site/assets/schematicDecode.js";

/**
 * "Clutter" blocks (`blocktypes/clutter.json`, `clutter-devastation`, `clutter-aquatic`; class
 * `BlockClutter`, behavior `ShapeFromAttributes`) are one block code whose actual look/identity is
 * a per-instance `type` attribute (e.g. "skull/human-crystal", "bone/skullwhale1") stored in the
 * placed block's block-entity data -- exactly the shape tapestries use. So, like
 * `tapestryInstances.ts`, this decodes `BlockEntities` out of every worldgen schematic a structure
 * actually references and records which `type` appears in which structure, how many times.
 *
 * Display name: `BlockClutter` builds its lang key as `"<ClassType>-" + type.Replace("/", "-")`
 * (`clutter-golem-skull` -> "Eidolon skull"); the `devastation`/`aquatic` variants use their own
 * block code as the class prefix, so both prefixes are tried before giving up.
 */
export function extractClutterTypes(
  schematicsByDomain: Map<string, SchematicFile[]>,
  schematicToStructure: Map<string, Set<string>>,
  structures: NormalizedStructure[],
  lang: LangResolver,
  stats?: DecodeStats
): ClutterType[] {
  const fullPathByKey = new Map<string, string>();
  for (const [domain, files] of schematicsByDomain) {
    for (const file of files) fullPathByKey.set(`${domain}:worldgen/schematics/${file.relPath}.json`, file.fullPath);
  }
  const structureById = new Map(structures.map((s) => [s.id, s]));
  const byId = new Map<string, ClutterType>();

  for (const [schematicKey, structureIds] of schematicToStructure) {
    const fullPath = fullPathByKey.get(schematicKey);
    if (!fullPath) continue;
    const bare = (c: string) => (c.includes(":") ? c.slice(c.indexOf(":") + 1) : c);
    // Cheap header-only pre-filter before parsing the (potentially large) schematic.
    if (!readSchematicBlockCodes(fullPath).some((c) => /^clutter(-devastation|-aquatic)?$/.test(bare(c)))) continue;

    let data: { BlockEntities?: Record<string, string> };
    try {
      data = JSON.parse(readFileSync(fullPath, "utf8"));
    } catch {
      if (stats) stats.unreadable++;
      continue;
    }
    if (!data.BlockEntities) continue;
    if (stats) stats.schematics++;
    const domain = schematicKey.slice(0, schematicKey.indexOf(":"));

    // Count per type within this schematic first, then fan out to every structure using it.
    const counts = new Map<string, { blockCode: string; count: number }>();
    for (const [packedIndex, blob] of Object.entries(data.BlockEntities)) {
      if (stats) stats.entities++;
      let decoded: { blockCode?: string; type?: string };
      try {
        decoded = decodeBlockEntity(blob);
      } catch (e) {
        recordDecodeFailure(stats, `${schematicKey} #${packedIndex}`, e);
        continue;
      }
      if (!decoded.blockCode || typeof decoded.type !== "string" || !decoded.type) continue;
      if (!/^clutter(-devastation|-aquatic)?$/.test(bare(decoded.blockCode))) continue;
      const key = `${decoded.blockCode}|${decoded.type}`;
      const entry = counts.get(key) ?? { blockCode: decoded.blockCode, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }

    for (const [key, { blockCode, count }] of counts) {
      const type = key.slice(key.indexOf("|") + 1);
      const gameDomain = domain === "survival" || domain === "creative" ? "game" : domain;
      // Keyed by type alone so the same clutter shipped under several domains (vanilla + a mod's
      // copy of it) is one row; the first-seen domain supplies the lang lookup and `domain` field.
      const id = type;
      let entry = byId.get(id);
      if (!entry) {
        const langKey = type.replace(/\//g, "-");
        const prefixes = [bare(blockCode), "clutter"];
        const name = prefixes.map((p) => lang.raw(domain, `${p}-${langKey}`)).find((n) => n !== undefined);
        entry = {
          id,
          type,
          domain: gameDomain,
          displayName: name ?? type,
          missingTranslation: name === undefined,
          sourceMod: "",
          blockCodes: [],
          structures: [],
        };
        byId.set(id, entry);
      }
      const bareBlock = bare(blockCode);
      if (!entry.blockCodes.includes(bareBlock)) entry.blockCodes.push(bareBlock);
      for (const structureId of structureIds) {
        const existing = entry.structures.find((s) => s.structureId === structureId);
        if (existing) existing.count += count;
        else entry.structures.push({ structureId, count });
        if (!entry.sourceMod) entry.sourceMod = structureById.get(structureId)?.sourceMod ?? "game";
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
