import { readFileSync } from "node:fs";
import type { SchematicFile } from "../schematicHeader.js";
import { readSchematicItemCodes } from "../schematicHeader.js";
// Same canonical decoder module the tapestry/clutter models import (Ascii85 only is needed here).
import { Ascii85 } from "../../../site/assets/schematicDecode.js";
import type { LoreBook, LoreFindMethod } from "./lore.js";

/**
 * Works out which structures a lore text can be found in, from three signals in the schematics a
 * structure actually references (never a blanket walk of every schematic file):
 *
 *  - `clutteredbookshelfwithlore` block entities carry a `loreCode` that is a *section*
 *    (`category`), e.g. "archives" -- any text in that section can come off that shelf. ("bookshelf")
 *  - container/ground-storage block entities that already hold a specific lore book carry
 *    `discoveryCode`, which is the text's own `code`. ("placed")
 *  - `stackrandomizer-<x>` in a schematic's `ItemCodes`, where `<x>` is a lore code or section
 *    (BetterRuins adds one per text). ("random loot")
 *
 * The block-entity values are read by regex over the *raw* decoded bytes rather than through the
 * attribute-tree parser: this predates the parser modelling item stacks (type 7) and was kept because
 * it works; `discoveryCode`/`loreCode` are always a key followed by a length-prefixed string, which is what the
 * pattern below matches. (~1s over every vanilla + BetterRuins schematic.)
 */
export function attachLoreLocations(
  books: LoreBook[],
  schematicsByDomain: Map<string, SchematicFile[]>,
  schematicToStructure: Map<string, Set<string>>
): void {
  const fullPathByKey = new Map<string, string>();
  for (const [domain, files] of schematicsByDomain) {
    for (const file of files) fullPathByKey.set(`${domain}:worldgen/schematics/${file.relPath}.json`, file.fullPath);
  }
  const byCode = new Map<string, LoreBook[]>();
  const byCategory = new Map<string, LoreBook[]>();
  for (const b of books) {
    (byCode.get(b.code) ?? byCode.set(b.code, []).get(b.code)!).push(b);
    (byCategory.get(b.category) ?? byCategory.set(b.category, []).get(b.category)!).push(b);
  }

  const record = (matched: LoreBook[], structureIds: Set<string>, via: LoreFindMethod) => {
    for (const book of matched) {
      for (const structureId of structureIds) {
        let loc = book.foundInStructures.find((l) => l.structureId === structureId);
        if (!loc) book.foundInStructures.push((loc = { structureId, via: [] }));
        if (!loc.via.includes(via)) loc.via.push(via);
      }
    }
  };

  for (const [schematicKey, structureIds] of schematicToStructure) {
    const fullPath = fullPathByKey.get(schematicKey);
    if (!fullPath) continue;

    for (const code of readSchematicItemCodes(fullPath)) {
      const m = /^(?:[a-z0-9_]+:)?stackrandomizer-(.+)$/.exec(code);
      if (!m) continue;
      record(byCode.get(m[1]) ?? byCategory.get(m[1]) ?? [], structureIds, "random loot");
    }

    let data: { BlockEntities?: Record<string, string> };
    try {
      data = JSON.parse(readFileSync(fullPath, "utf8"));
    } catch {
      continue;
    }
    for (const blob of Object.values(data.BlockEntities ?? {})) {
      let text: string;
      try {
        text = Buffer.from(new Uint8Array(Ascii85.decode(blob))).toString("latin1");
      } catch {
        continue;
      }
      if (!text.includes("discoveryCode") && !text.includes("loreCode")) continue;
      // key, then (attribute-type byte or a length byte), then a length byte + the string itself.
      for (const m of text.matchAll(/(discoveryCode|loreCode)[\x00-\x20]?[\x00-\x40]([a-z0-9_-]{2,40})/g)) {
        const [, key, value] = m;
        if (key === "loreCode") record(byCategory.get(value) ?? byCode.get(value) ?? [], structureIds, "bookshelf");
        else record(byCode.get(value) ?? byCategory.get(value) ?? [], structureIds, "placed");
      }
    }
  }
}
