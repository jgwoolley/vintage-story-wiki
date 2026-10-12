import type { AssetIndex, GuideInfo } from "../types.js";
import type { LangResolver } from "../lang.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";
import { splitDomainCode } from "../codeUtil.js";

function resolveLangRef(lang: LangResolver, fallbackDomain: string, ref: string): string {
  const { domain, bareCode } = splitDomainCode(ref, fallbackDomain);
  return lang.raw(domain, bareCode) ?? ref;
}

/**
 * Rewrites the `handbook://`/`handbooksearch://` links embedded in a guide's HTML text into real
 * site-relative paths. Only the 3 link shapes actually observed in the raw game text are
 * recognized (item-/block- codes, a cross-reference to another guide's own pageCode, and a
 * free-text handbook search) -- anything else matching `handbook://` is left as inert,
 * non-functional link text rather than guessed at. Paths are emitted lang-prefix-free with a
 * `__LANG__` placeholder (ingest has no concept of the site's `/<lang>/` routing, which only
 * exists at Eleventy render time) -- the template splices in the real prefix via a string
 * `replace` before applying `| safe` (see `site/guides/guides.njk`).
 */
function rewriteHandbookLinks(html: string): string {
  return html
    .replace(/handbook:\/\/item-([a-z0-9-]+)/gi, (_m, code) => `__LANG__items/survival/${code}/`)
    .replace(/handbook:\/\/block-([a-z0-9-]+)/gi, (_m, code) => `__LANG__items/survival/${code}/`)
    .replace(/handbook:\/\/((?:craftinginfo|gamemechanicinfo)-[a-z0-9-]+)/gi, (_m, pageCode) => `__LANG__guides/survival/${pageCode}/`)
    .replace(/handbooksearch:\/\/([^"<]+)/gi, (_m, text) => `__LANG__items/?q=${encodeURIComponent(text)}`);
}

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
