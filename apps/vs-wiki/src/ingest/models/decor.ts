import type { AssetIndex, DecorItem, DecorKind } from "../types.js";
import type { LangResolver } from "vs-wiki-core/lang.js";
import { expandVariants } from "vs-wiki-core/variantExpander.js";

const CLOTHING_FILES = [
  "arm",
  "emblem-butterflypin",
  "emblem",
  "face",
  "foot",
  "hand",
  "head-fur",
  "head",
  "lowerbody",
  "neck",
  "shoulder",
  "upperbody",
  "upperbodyover",
  "waist",
];

const TARGET_REL_PATHS = [
  "blocktypes/wood/painting.json",
  "blocktypes/cloth/tapestry.json",
  ...CLOTHING_FILES.map((f) => `itemtypes/wearable/seraph/${f}.json`),
];

function classify(baseCode: string): DecorKind | undefined {
  if (baseCode === "painting") return "painting";
  if (baseCode === "tapestry") return "tapestry";
  if (baseCode === "clothes") return "clothing";
  return undefined;
}

/**
 * Paintings, tapestries, and clothing are purely decorative/cosmetic content with no recipe and
 * no drop table (worldgen placement, the creative `/giveblock` command, or NPC trade are the only
 * ways to get them in survival -- see README's catalog-completeness limitation). The normal
 * recipe/loot-driven item index never sees them, so this is a separate, deliberate full-registry
 * walk scoped to just these three categories. Uses the real index (not a synthetic single-asset
 * one) since variant resolution needs cross-file lookups (e.g. painting/tapestry's
 * `loadFromProperties` pointing at a worldproperties file).
 */
export function extractDecorCatalog(index: AssetIndex, lang: LangResolver): DecorItem[] {
  const out: DecorItem[] = [];

  for (const variant of expandVariants(index, TARGET_REL_PATHS)) {
    const kind = classify(variant.baseCode);
    if (!kind) continue;

    const itemKind: "item" | "block" = kind === "clothing" ? "item" : "block";
    const { name, missing } = lang.displayName(itemKind, variant.domain, variant.code);
    out.push({
      id: `${variant.domain}:${kind}/${variant.code}`,
      kind,
      itemKind,
      domain: variant.domain,
      code: variant.code,
      displayName: missing ? variant.code : name,
      description: lang.description(itemKind, variant.domain, variant.code),
      sourceMod: variant.sourceModid,
      foundInStructures: [],
    });
  }

  return out;
}
