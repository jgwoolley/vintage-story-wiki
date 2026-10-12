import type { AssetIndex } from "./types.js";
import { globToRegExp } from "./variantExpander.js";

export interface LangResolver {
  displayName(kind: "item" | "block" | "entity", domain: string, code: string): { name: string; missing: boolean };
  /** Flavor-text description (e.g. "itemdesc-<code>"/"blockdesc-<code>"), or undefined if the game
   * never defined one -- unlike displayName, absence here is common and not an error to flag. */
  description(kind: "item" | "block", domain: string, code: string): string | undefined;
  /** Plain lang-key lookup with no "item-"/"block-" prefix added, for keys referenced literally
   * elsewhere in the asset data (e.g. a lore config's "title" and "pieces" fields). */
  raw(domain: string, key: string): string | undefined;
  /** Resolves a tapestry/wallcarving "type" runtime attribute value (e.g. "temporality1") to its
   * display name, the same two-key composition `BlockTapestry.GetPlacedBlockName` uses: a glob
   * match on `"<prefix>-" + type` plugged into the `"<prefix>-name"` template. */
  tapestryName(domain: string, prefix: "tapestry" | "wallcarving", type: string): string | undefined;
}

/** Entities don't use a plain "entity-<code>" key -- the game looks them up as "item-creature-<code>". */
function keyFor(kind: "item" | "block" | "entity", code: string): string {
  return kind === "entity" ? `item-creature-${code}` : `${kind}-${code}`;
}

interface DomainLang {
  exact: Record<string, string>;
  wildcard: { pattern: string; regex: RegExp; name: string }[];
}

function splitExactAndWildcard(map: Record<string, string>): DomainLang {
  const exact: Record<string, string> = {};
  const wildcard: DomainLang["wildcard"] = [];
  for (const [key, name] of Object.entries(map)) {
    if (key.includes("*")) wildcard.push({ pattern: key, regex: globToRegExp(key), name });
    else exact[key] = name;
  }
  // longest (most specific) pattern first, so a more specific wildcard wins over a shorter one
  wildcard.sort((a, b) => b.pattern.length - a.pattern.length);
  return { exact, wildcard };
}

function lookup(lang: DomainLang | undefined, fullKey: string): string | undefined {
  if (!lang) return undefined;
  if (lang.exact[fullKey]) return lang.exact[fullKey];
  for (const w of lang.wildcard) {
    if (w.regex.test(fullKey)) return w.name;
  }
  return undefined;
}

const ORE_GRADES = new Set(["poor", "medium", "rich", "bountiful"]);

/**
 * Ore/crystalizedore chunk items don't resolve via a flat "item-<code>" lang key at all -- the
 * game's ItemOre.GetHeldItemName composes the name from two separate lookups: a per-grade template
 * ("rich-ore-chunk" -> "Rich chunk of {0}") plus a per-mineral name ("ore-ilmenite" -> "Ilmenite"),
 * ignoring the rock-type segment entirely. Mirrors that composition (confirmed against
 * anegostudios/vssurvivalmod's Item/ItemOre.cs) since it accounts for the large majority of
 * otherwise-"missing" items once the allowedVariants over-generation fix is in place.
 */
function composeOreName(lang: DomainLang | undefined, code: string): string | undefined {
  const parts = code.split("-");
  if (parts.length !== 4) return undefined;
  const [prefix, grade, ore] = parts;
  if ((prefix !== "ore" && prefix !== "crystalizedore") || !ORE_GRADES.has(grade)) return undefined;

  const mineralName = lookup(lang, `ore-${ore}`);
  const templateSuffix = prefix === "crystalizedore" ? "crystallizedore-chunk" : "ore-chunk";
  const template = lookup(lang, `${grade}-${templateSuffix}`);
  if (!mineralName || !template) return undefined;
  return template.replace("{0}", mineralName);
}

const METALBLOCK_STATES = new Set(["new", "corroded"]);
const METALBLOCK_TYPES = new Set(["plain", "riveted"]);

/**
 * `metalblock-<state>-<type>-<metal>` (`blocktypes/metal/metalblock.json`'s 3 variant groups:
 * state=new/corroded, type=plain/riveted, metal=<~19 metals, loadFromProperties>) only ever
 * authors a lang key per metal (`block-metalblock-<metal>`, confirmed: no state/type segment and
 * no wildcard key exists in the real lang file at all) -- the corroded/riveted/new/plain
 * distinction is purely cosmetic (just a different texture) and genuinely has no separate name.
 * Strips the state/type tokens (when present at the front) and looks up the remaining metal name
 * alone, rather than guessing a generic "drop the last N tokens" rule that could silently collide
 * with an unrelated real key for a different block family.
 */
function composeMetalBlockName(lang: DomainLang | undefined, code: string): string | undefined {
  if (!code.startsWith("metalblock-")) return undefined;
  const tokens = code.slice("metalblock-".length).split("-");
  if (METALBLOCK_STATES.has(tokens[0])) tokens.shift();
  if (METALBLOCK_TYPES.has(tokens[0])) tokens.shift();
  if (!tokens.length) return undefined;
  // metalblock is always a block (never an item), so the real key always carries the "block-"
  // prefix (confirmed: "block-metalblock-copper" exists in the real lang file) -- hardcoded here
  // rather than taking a `kind` parameter, since there's no item-kind variant of this to resolve.
  return lookup(lang, `block-metalblock-${tokens.join("-")}`);
}

/**
 * Tapestries/wallcarvings don't resolve via a flat "<prefix>-<type>" key either -- mirrors
 * `BlockTapestry.GetPlacedBlockName`/`GetHeldItemName` (confirmed against
 * anegostudios/vssurvivalmod's Block/BlockTapestry.cs): `Lang.GetMatching("<prefix>-" + type)`
 * (a glob match, e.g. "tapestry-nightfall*" -> "Nightfall") plugged into the
 * `"<prefix>-name"` template (e.g. "{0} (tapestry)").
 */
function composeTapestryName(lang: DomainLang | undefined, prefix: "tapestry" | "wallcarving", type: string): string | undefined {
  const matched = lookup(lang, `${prefix}-${type}`);
  const template = lookup(lang, `${prefix}-name`);
  if (!matched || !template) return undefined;
  return template.replace("{0}", matched);
}

/** Loads lang/en.json for every active domain (own-domain first, vanilla game/lang as shared fallback). */
export function buildLangResolver(index: AssetIndex, lang = "en"): LangResolver {
  // Mods can author a lang key as a literal "<domain>:<realkey>" string inside their *own*
  // lang/en.json, to inject it into a different domain's namespace (confirmed real and common,
  // not a one-off: BetterRuins does this for 367 keys, Stone Quarry for 32, mostly to put handbook
  // guide/lore text under "game:" so vanilla-style handbook:// links can reference it without a
  // domain prefix). A bare per-domain load misses these entirely -- redistribute any such key into
  // its target domain's raw map (merged with that domain's own file) before splitting
  // exact/wildcard, so e.g. `lang.raw("stonequarry", "stonequarry-quarryguide-title")`, which
  // falls back to the "game" domain, actually finds a key that was never really filed under
  // "stonequarry" at all.
  const rawByDomain = new Map<string, Record<string, string>>();
  for (const asset of index.values()) {
    if (asset.relPath !== `lang/${lang}.json`) continue;
    const fileMap = asset.json as Record<string, string>;
    for (const [key, value] of Object.entries(fileMap)) {
      const colon = key.indexOf(":");
      const targetDomain = colon === -1 ? asset.domain : key.slice(0, colon);
      const targetKey = colon === -1 ? key : key.slice(colon + 1);
      const bucket = rawByDomain.get(targetDomain) ?? {};
      bucket[targetKey] = value;
      rawByDomain.set(targetDomain, bucket);
    }
  }
  const perDomain = new Map<string, DomainLang>();
  for (const [domain, raw] of rawByDomain) {
    perDomain.set(domain, splitExactAndWildcard(raw));
  }
  const vanillaFallback = perDomain.get("game");

  return {
    displayName(kind, domain, code) {
      const key = keyFor(kind, code);
      const domainLang = perDomain.get(domain);
      const name =
        lookup(domainLang, key) ??
        lookup(vanillaFallback, key) ??
        composeOreName(domainLang, code) ??
        composeOreName(vanillaFallback, code) ??
        composeMetalBlockName(domainLang, code) ??
        composeMetalBlockName(vanillaFallback, code);
      if (name) return { name, missing: false };
      return { name: code, missing: true };
    },
    description(kind, domain, code) {
      const key = `${kind}desc-${code}`;
      const domainLang = perDomain.get(domain);
      return lookup(domainLang, key) ?? lookup(vanillaFallback, key);
    },
    raw(domain, key) {
      return lookup(perDomain.get(domain), key) ?? lookup(vanillaFallback, key);
    },
    tapestryName(domain, prefix, type) {
      const domainLang = perDomain.get(domain);
      return composeTapestryName(domainLang, prefix, type) ?? composeTapestryName(vanillaFallback, prefix, type);
    },
  };
}
