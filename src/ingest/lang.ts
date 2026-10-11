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

/** Loads lang/en.json for every active domain (own-domain first, vanilla game/lang as shared fallback). */
export function buildLangResolver(index: AssetIndex, lang = "en"): LangResolver {
  const perDomain = new Map<string, DomainLang>();
  for (const asset of index.values()) {
    if (asset.relPath === `lang/${lang}.json`) {
      perDomain.set(asset.domain, splitExactAndWildcard(asset.json as Record<string, string>));
    }
  }
  const vanillaFallback = perDomain.get("game");

  return {
    displayName(kind, domain, code) {
      const key = keyFor(kind, code);
      const domainLang = perDomain.get(domain);
      const name =
        lookup(domainLang, key) ?? lookup(vanillaFallback, key) ?? composeOreName(domainLang, code) ?? composeOreName(vanillaFallback, code);
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
  };
}
