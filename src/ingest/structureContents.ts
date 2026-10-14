import type { NormalizedStructure } from "./types.js";
import type { SchematicFile } from "./schematicHeader.js";
import { readSchematicBlockCodes, readSchematicItemCodes } from "./schematicHeader.js";

function bareCodeOf(raw: string): string {
  return raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
}

/**
 * One pass over every schematic file's (small) BlockCodes dict, mapping each bare block code to
 * every schematic that contains it. Reusable across any number of "which structures contain X"
 * lookups without re-scanning the schematic files per lookup.
 */
export function buildBlockCodeToSchematicIndex(schematicsByDomain: Map<string, SchematicFile[]>): Map<string, Set<string>> {
  return buildCodeToSchematicIndex(schematicsByDomain, readSchematicBlockCodes);
}

/**
 * Same as `buildBlockCodeToSchematicIndex` but over each schematic's `ItemCodes` dictionary: the
 * items placed inside containers (chests, vessels, ...), notably the `stackrandomizer-*` items that
 * world generation rolls into real loot. Kept separate because those codes are item codes, not blocks.
 */
export function buildItemCodeToSchematicIndex(schematicsByDomain: Map<string, SchematicFile[]>): Map<string, Set<string>> {
  return buildCodeToSchematicIndex(schematicsByDomain, readSchematicItemCodes);
}

function buildCodeToSchematicIndex(
  schematicsByDomain: Map<string, SchematicFile[]>,
  readCodes: (fullPath: string) => string[]
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const [domain, files] of schematicsByDomain) {
    for (const file of files) {
      const schematicKey = `${domain}:worldgen/schematics/${file.relPath}.json`;
      for (const raw of readCodes(file.fullPath)) {
        const bare = bareCodeOf(raw);
        const set = index.get(bare) ?? new Set();
        set.add(schematicKey);
        index.set(bare, set);
      }
    }
  }
  return index;
}

/** Reverse index: which structures reference a given schematic (keyed by `SchematicInfo.id`). */
export function buildSchematicToStructureIndex(structures: NormalizedStructure[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const structure of structures) {
    for (const ref of structure.schematics) {
      for (const schematicId of ref.schematicIds) {
        const set = index.get(schematicId) ?? new Set();
        set.add(structure.id);
        index.set(schematicId, set);
      }
    }
  }
  return index;
}

/** All structure ids whose schematics contain the given (domain-prefix-agnostic) block code. */
export function findStructuresContaining(
  code: string,
  blockCodeToSchematic: Map<string, Set<string>>,
  schematicToStructure: Map<string, Set<string>>
): string[] {
  const schematicKeys = blockCodeToSchematic.get(bareCodeOf(code));
  if (!schematicKeys) return [];
  const structureIds = new Set<string>();
  for (const key of schematicKeys) {
    for (const id of schematicToStructure.get(key) ?? []) structureIds.add(id);
  }
  return [...structureIds];
}
