import type { AssetIndex } from "../types.js";
import type { LangResolver } from "../lang.js";
import { expandVariants } from "../variantExpander.js";

/** Vanilla assets live in several asset folders, but schematics (and the game at runtime) refer to all of them as the "game" domain. */
const VANILLA_FOLDER_DOMAINS = new Set(["game", "survival", "creative"]);

/**
 * Flat `"<domain>:<concrete block code>" -> localized display name` lookup covering every concrete
 * block variant (not just the recipe/loot-graph subset in `generated.items`), keyed the way a
 * schematic's `BlockCodes` writes them (vanilla is always `game:`). Consumed client-side by the
 * schematic viewer (`site/assets/schematicViewer.js`) so its block legend uses the wiki's own
 * localization. Blocks with no resolvable translation are omitted; the viewer falls back to the code.
 */
export function extractBlockNames(index: AssetIndex, lang: LangResolver): Record<string, string> {
  const out: Record<string, string> = {};
  for (const variant of expandVariants(index, ["blocktypes/"])) {
    const { name, missing } = lang.displayName("block", variant.domain, variant.code);
    if (missing || !name) continue;
    const domain = VANILLA_FOLDER_DOMAINS.has(variant.domain) ? "game" : variant.domain;
    out[`${domain}:${variant.code}`] ??= name;
  }
  return out;
}
