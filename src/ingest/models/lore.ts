import type { AssetIndex } from "../types.js";
import type { LangResolver } from "../lang.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";
import { resolveLangRef } from "../codeUtil.js";

export interface LoreBook {
  id: string;
  code: string;
  domain: string;
  sourceMod: string;
  title: string;
  category: string;
  /** One entry per `pieces` key, already split on the game's own "___NEWPAGE___" page-break marker. */
  pages: string[][];
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
      pages: json.pieces.map((piece) => resolveLangRef(lang, asset.domain, piece).split("___NEWPAGE___")),
    });
  }

  return out;
}
