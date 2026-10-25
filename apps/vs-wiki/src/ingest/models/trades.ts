import type { AssetIndex, TradeList, TradeListing } from "../types.js";
import { assetsUnderAnyDomain } from "vs-wiki-core/assetLoader.js";

type RawListing = { code?: string; type?: string; stacksize?: number; stock?: { avg?: number; var?: number }; price?: { avg?: number; var?: number }; attributes?: { type?: unknown } };

function normalizeListings(raw: RawListing[], tradeListId: string, direction: "selling" | "buying", defaultDomain: string): TradeListing[] {
  const out: TradeListing[] = [];
  raw.forEach((r, i) => {
    if (!r.code) return;
    // A listing may name its item's domain ("betterruins:locatormap-mine1", added to a vanilla list by a mod's patch);
    // a bare code is the list's own domain.
    const colon = r.code.indexOf(":");
    const domain = colon >= 0 ? r.code.slice(0, colon) : defaultDomain;
    const code = colon >= 0 ? r.code.slice(colon + 1) : r.code;
    const stockAvg = r.stock?.avg;
    const stockVar = r.stock?.var;
    const priceAvg = r.price?.avg;
    const priceVar = r.price?.var;
    out.push({
      id: `${tradeListId}#${direction}#${i}`,
      tradeListId,
      direction,
      domain,
      code,
      itemKind: r.type === "block" ? "block" : "item",
      ...(/^clutter/.test(code) && typeof r.attributes?.type === "string" ? { clutterType: r.attributes.type } : {}),
      stacksize: r.stacksize,
      stockAvg,
      stockVar,
      priceAvg,
      priceVar,
      // min/max are a plain derived range (avg - var / avg + var) for templates that want to show
      // "12-18" instead of "15 ± 3" -- see TradeListing's doc comment. var defaults to 0 when
      // absent (a fixed-amount listing), never left undefined just because var itself is missing.
      stockMin: stockAvg !== undefined ? stockAvg - (stockVar ?? 0) : undefined,
      stockMax: stockAvg !== undefined ? stockAvg + (stockVar ?? 0) : undefined,
      priceMin: priceAvg !== undefined ? priceAvg - (priceVar ?? 0) : undefined,
      priceMax: priceAvg !== undefined ? priceAvg + (priceVar ?? 0) : undefined,
    });
  });
  return out;
}

/**
 * Wandering trader buy/sell lists (`config/tradelists/trader-<specialization>.json`) -- one file
 * per specialization (survivalgoods, artisan, buildmaterials, etc.), each a flat
 * `{money, selling: {list}, buying: {list}}` object. Trade entries can repeat the same base
 * `code` with different `attributes` (e.g. a tapestry listed many times under different "type"
 * attribute values) -- not modeled here, only the base code/price/stock range is kept, since the
 * attribute variations are themselves cosmetic/randomized rather than distinct tradeable things. The one exception is
 * the generic `clutter` block, whose `type` attribute IS what is being sold (`TradeListing.clutterType`).
 * Trader *personality* assignment (which specialization a given trader entity uses, picked via a
 * `variantgroups`-driven `type` on `entities/humanoid/trader-{male,female}.json`) is cross-
 * referenced in `index.ts` after this and entity extraction have both run -- see
 * `TraderEntityRef`'s doc comment in `types.ts` for how the join works, and `TradeList.traderEntities`
 * below (left empty here, filled in by `index.ts`). NPC dialogue trees
 * (`config/dialogue/trader.json` and friends, a genuine branching state machine, not flat flavor
 * text) are extracted separately -- see `models/dialogue.ts` -- this only covers what's actually
 * for sale plus which entities sell it.
 */
export function extractTrades(index: AssetIndex): TradeList[] {
  const out: TradeList[] = [];

  for (const asset of assetsUnderAnyDomain(index, "config/tradelists/")) {
    const filename = asset.relPath.split("/").pop() ?? "";
    const code = filename.replace(/^trader-/, "").replace(/\.json$/, "");
    const json = asset.json as {
      money?: { avg?: number; var?: number };
      selling?: { list?: RawListing[] };
      buying?: { list?: RawListing[] };
    };
    const id = `${asset.domain}:${code}`;

    out.push({
      id,
      domain: asset.domain,
      sourceMod: asset.modid,
      moneyAvg: json.money?.avg,
      moneyVar: json.money?.var,
      selling: normalizeListings(json.selling?.list ?? [], id, "selling", asset.domain),
      buying: normalizeListings(json.buying?.list ?? [], id, "buying", asset.domain),
      // Populated in index.ts, after the trader entities themselves are extracted -- see
      // TraderEntityRef's doc comment for why that cross-reference can't happen here.
      traderEntities: [],
      displayName: "", // filled in by index.ts once trader entities are matched
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}
