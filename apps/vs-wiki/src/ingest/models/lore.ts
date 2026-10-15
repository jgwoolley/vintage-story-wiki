import type { AssetIndex } from "../types.js";
import type { LangResolver } from "vs-wiki-core/lang.js";
import { assetsUnderAnyDomain } from "vs-wiki-core/assetLoader.js";
import { resolveLangRef } from "../codeUtil.js";

/**
 * `config/lore/<code>.json` codes that are *chapter collections revealed by tapestries/wallcarvings*
 * rather than a book you find and read -- see `tapestryInstances.ts`'s `PrefixConfig.loreBookCode`
 * (the same two prefixes). Everything else in `config/lore/` is a book/journal/note.
 */
const CHAPTER_LORE_CODES = new Set(["tapestry", "wallcarving"]);

/** One way a lore text can be encountered inside a structure's schematics. */
export type LoreFindMethod =
  | "bookshelf" // a `clutteredbookshelfwithlore` block whose `loreCode` is this text's section (category)
  | "placed" // a container/ground-storage block entity holding a lore book whose `discoveryCode` is this text's code
  | "random loot"; // a `stackrandomizer-<code or section>` item, rolled into some container at worldgen

export interface LoreLocation {
  structureId: string;
  /** Every distinct way it can be found in this structure (a text can be both on a shelf and placed). */
  via: LoreFindMethod[];
}

export interface LoreBook {
  id: string;
  code: string;
  domain: string;
  sourceMod: string;
  title: string;
  /** The lore *section* (`category` in the JSON): the grouping the game's journal files this text under. Several texts can share one. */
  category: string;
  /** "book" = a findable book/journal/note (listed on /books/); "chapters" = a tapestry/wallcarving chapter collection (stays under /lore/). */
  kind: "book" | "chapters";
  /** One entry per `pieces` key, already split on the game's own "___NEWPAGE___" page-break marker. */
  pages: string[][];
  /** Structures whose schematics contain this text (filled in by `attachLoreLocations`); empty for tapestry/wallcarving chapters (see /tapestries/) and anything never placed by worldgen. */
  foundInStructures: LoreLocation[];
}

/**
 * Readable in-game book/journal/tapestry-lore content. `config/lore/<code>.json` files (vanilla
 * and mods alike) just list a title key and an ordered array of "piece" lang keys -- the actual
 * prose lives in the lang file itself, same mechanism used for every other display string.
 */
export function extractLoreBooks(index: AssetIndex, lang: LangResolver): LoreBook[] {
  const out: LoreBook[] = [];

  for (const asset of assetsUnderAnyDomain(index, "config/lore/")) {
    const json = asset.json as { code?: string; title?: string; category?: string; pieces?: string[] };
    if (!json.code || !Array.isArray(json.pieces)) continue;

    out.push({
      id: `${asset.domain}:${json.code}`,
      code: json.code,
      domain: asset.domain,
      sourceMod: asset.modid,
      title: json.title ? resolveLangRef(lang, asset.domain, json.title) : json.code,
      category: json.category ?? "misc",
      kind: CHAPTER_LORE_CODES.has(json.code) ? "chapters" : "book",
      pages: json.pieces.map((piece) => resolveLangRef(lang, asset.domain, piece).split("___NEWPAGE___")),
      foundInStructures: [],
    });
  }

  return out;
}

/** One lore section (all texts sharing a `category`), the grouping shown on /lore/. */
export interface LoreSection {
  /** The `category` value, e.g. "archives". */
  id: string;
  /** The game's own one-line description of what this kind of find is (`loretype-<id>` lang key, e.g. "Researchers notes found near a meteor impact site."), if it has one. */
  description?: string;
  sourceMod: string;
  /** `LoreBook.id`s in this section, in file order. */
  bookIds: string[];
  /** Union of its texts' `foundInStructures`, by structure. */
  structures: LoreLocation[];
}

export function buildLoreSections(books: LoreBook[], lang: LangResolver): LoreSection[] {
  const byCategory = new Map<string, LoreSection>();
  for (const book of books) {
    let section = byCategory.get(book.category);
    if (!section) {
      // Mods author `game:loretype-...` keys into the vanilla namespace (see lang.ts), so try
      // "game" before the text's own domain.
      const key = `loretype-${book.category}`;
      section = {
        id: book.category,
        description: lang.raw("game", key) ?? lang.raw(book.domain, key),
        sourceMod: book.sourceMod,
        bookIds: [],
        structures: [],
      };
      byCategory.set(book.category, section);
    }
    section.bookIds.push(book.id);
    for (const loc of book.foundInStructures) {
      const existing = section.structures.find((s) => s.structureId === loc.structureId);
      if (existing) {
        for (const v of loc.via) if (!existing.via.includes(v)) existing.via.push(v);
      } else {
        section.structures.push({ structureId: loc.structureId, via: [...loc.via] });
      }
    }
  }
  return [...byCategory.values()].sort((a, b) => a.id.localeCompare(b.id));
}
