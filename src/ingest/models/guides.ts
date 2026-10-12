import type { AssetIndex, GuideInfo } from "../types.js";
import type { LangResolver } from "../lang.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";
import { resolveLangRef, rewriteHandbookLinks } from "../codeUtil.js";

/**
 * In-game handbook help-guide articles (`config/handbook/<NN>-<name>.json`) -- the game's own
 * "Guides" tab content. Each file is a flat `{pageCode, title, text}` object, `title`/`text`
 * being lang-key references resolved the same way lore book title/pieces are (see
 * `models/lore.ts`) -- the actual prose lives in the lang file, not inline in these files. There
 * is no ordering field in the data at all; the two-digit numeric filename prefix is the only
 * ordering signal that exists anywhere.
 */
export function extractGuides(index: AssetIndex, lang: LangResolver): GuideInfo[] {
  const out: GuideInfo[] = [];

  for (const asset of assetsUnderAnyDomain(index, "config/handbook/")) {
    const json = asset.json as { pageCode?: string; title?: string; text?: string };
    if (!json.pageCode) continue;

    const filename = asset.relPath.split("/").pop() ?? "";
    const orderMatch = filename.match(/^(\d+)-/);
    const order = orderMatch ? parseInt(orderMatch[1], 10) : 999;

    const title = json.title ? resolveLangRef(lang, asset.domain, json.title) : json.pageCode;
    const rawText = json.text ? resolveLangRef(lang, asset.domain, json.text) : "";

    out.push({
      id: json.pageCode,
      domain: asset.domain,
      sourceMod: asset.modid,
      title,
      html: rewriteHandbookLinks(rawText),
      order,
    });
  }

  return out.sort((a, b) => a.order - b.order);
}
