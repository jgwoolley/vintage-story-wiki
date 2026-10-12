import type { LangResolver } from "./lang.js";

/** Splits a possibly domain-prefixed code ("betterruins:schematic-x" / "rock-*") into {domain, bareCode}. */
export function splitDomainCode(raw: string, fallbackDomain: string): { domain: string; bareCode: string } {
  const idx = raw.indexOf(":");
  if (idx === -1) return { domain: fallbackDomain, bareCode: raw };
  return { domain: raw.slice(0, idx), bareCode: raw.slice(idx + 1) };
}

/** Resolves a lang-key reference (possibly domain-prefixed, e.g. a lore config's "title"/"pieces"
 * fields, a guide's "text", or a dialogue line's "value") via `lang.raw`, falling back to the
 * literal reference itself when no lang key matches -- which is also what makes this work for the
 * (common) case where the "reference" is actually just inline literal text rather than a lang key
 * at all (e.g. dialogue component text is a mix of both). Shared by `models/lore.ts`,
 * `models/guides.ts`, and `models/dialogue.ts` -- all three resolve references the same way. */
export function resolveLangRef(lang: LangResolver, fallbackDomain: string, ref: string): string {
  const { domain, bareCode } = splitDomainCode(ref, fallbackDomain);
  return lang.raw(domain, bareCode) ?? ref;
}

/**
 * Rewrites the `handbook://`/`handbooksearch://` links embedded in resolved lang text into real
 * site-relative paths. Only the 3 link shapes actually observed in the raw game text are
 * recognized (item-/block- codes, a cross-reference to another guide's own pageCode, and a
 * free-text handbook search) -- anything else matching `handbook://` is left as inert,
 * non-functional link text rather than guessed at. Paths are emitted lang-prefix-free with a
 * `__LANG__` placeholder (ingest has no concept of the site's `/<lang>/` routing, which only
 * exists at Eleventy render time) -- the template splices in the real prefix via a string
 * `replace` before applying `| safe` (see `site/guides/guides.njk`). Shared by `models/guides.ts`
 * and `models/dialogue.ts` -- dialogue line text runs through the exact same lang-text pipeline as
 * handbook guide text, just resolved from a different config file.
 */
export function rewriteHandbookLinks(html: string): string {
  return html
    .replace(/handbook:\/\/item-([a-z0-9-]+)/gi, (_m, code) => `__LANG__items/survival/${code}/`)
    .replace(/handbook:\/\/block-([a-z0-9-]+)/gi, (_m, code) => `__LANG__items/survival/${code}/`)
    .replace(/handbook:\/\/((?:craftinginfo|gamemechanicinfo)-[a-z0-9-]+)/gi, (_m, pageCode) => `__LANG__guides/survival/${pageCode}/`)
    .replace(/handbooksearch:\/\/([^"<]+)/gi, (_m, text) => `__LANG__items/?q=${encodeURIComponent(text)}`);
}

/**
 * Strips HTML tags from a lang value that was authored for the game's own in-game rich-text
 * renderer (e.g. trait names: `<font color="#84ff84">• Soldier </font>`) rather than for a web
 * page -- also strips the leading "• " bullet those specific strings carry, since it's a
 * UI-chrome artifact of the game's own trait list widget, not part of the name itself. Used by
 * `models/classes.ts` for trait display names.
 */
export function stripGameRichText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*[••]\s*/, "")
    .trim();
}
