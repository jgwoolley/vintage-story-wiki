import type { AssetIndex } from "../types.js";
import type { LangResolver } from "../lang.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";
import { splitDomainCode } from "../codeUtil.js";

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

function resolveLangRef(lang: LangResolver, fallbackDomain: string, ref: string): string {
  const { domain, bareCode } = splitDomainCode(ref, fallbackDomain);
  return lang.raw(domain, bareCode) ?? ref;
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
