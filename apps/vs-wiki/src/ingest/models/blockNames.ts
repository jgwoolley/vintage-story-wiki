import type { AssetIndex } from "../types.js";
import type { LangResolver } from "vs-wiki-core/lang.js";
import { expandVariants } from "vs-wiki-core/variantExpander.js";

/** Vanilla assets live in several asset folders, but schematics (and the game at runtime) refer to all of them as the "game" domain. */
const VANILLA_FOLDER_DOMAINS = new Set(["game", "survival", "creative"]);

/**
 * Flat `"<domain>:<concrete block code>" -> localized display name` lookup covering every concrete
 * block variant (not just the recipe/loot-graph subset in `generated.items`), keyed the way a
 * schematic's `BlockCodes` writes them (vanilla is always `game:`). Consumed client-side by the
 * schematic viewer (`site/assets/schematicViewer.js`) so its block legend uses the wiki's own
 * localization.
 *
 * Plenty of concrete variants have no lang key of their own (the game names them from the sibling you
 * can pick up: `woodenfence-oak-e-free` has no key, `woodenfence-oak-ew-free` -> "Wooden fence (Oak)"). Those
 * borrow the name of the sibling variant (same block definition) sharing the most variant-group values,
 * so the wood stays right while orientation/cover are ignored. Blocks with no named sibling are omitted;
 * the viewer then falls back to the code.
 */
export function extractBlockNames(index: AssetIndex, lang: LangResolver): Record<string, string> {
  const out: Record<string, string> = {};
  const named = new Map<string, { groupValues: Record<string, string>; name: string }[]>();
  const unnamed: { key: string; family: string; groupValues: Record<string, string> }[] = [];
  for (const variant of expandVariants(index, ["blocktypes/"])) {
    const { name, missing } = lang.displayName("block", variant.domain, variant.code);
    const domain = VANILLA_FOLDER_DOMAINS.has(variant.domain) ? "game" : variant.domain;
    const key = `${domain}:${variant.code}`;
    const family = `${domain}:${variant.baseCode}:${variant.sourceFile}`;
    if (missing || !name) {
      unnamed.push({ key, family, groupValues: variant.groupValues });
      continue;
    }
    out[key] ??= name;
    if (!named.has(family)) named.set(family, []);
    named.get(family)!.push({ groupValues: variant.groupValues, name });
  }
  for (const { key, family, groupValues } of unnamed) {
    if (out[key]) continue;
    let best: string | undefined;
    let bestScore = 0;
    for (const sibling of named.get(family) ?? []) {
      const score = Object.entries(groupValues).filter(([group, value]) => sibling.groupValues[group] === value).length;
      if (score > bestScore) [best, bestScore] = [sibling.name, score];
    }
    if (best) out[key] = best;
  }
  return out;
}
