import type { AssetIndex, TradeList, TradeListing } from "../types.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";

type RawListing = { code?: string; type?: string; stacksize?: number; stock?: { avg?: number; var?: number }; price?: { avg?: number; var?: number } };

function normalizeListings(raw: RawListing[], tradeListId: string, direction: "selling" | "buying"): TradeListing[] {
  const out: TradeListing[] = [];
  raw.forEach((r, i) => {
    if (!r.code) return;
    out.push({
      id: `${tradeListId}#${direction}#${i}`,
      tradeListId,
      direction,
      domain: "survival",
      code: r.code,
      itemKind: r.type === "block" ? "block" : "item",
      stacksize: r.stacksize,
      stockAvg: r.stock?.avg,
      stockVar: r.stock?.var,
      priceAvg: r.price?.avg,
      priceVar: r.price?.var,
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
 * attribute variations are themselves cosmetic/randomized rather than distinct tradeable things.
 * Trader *personality* assignment (which specialization a given trader entity uses, picked via a
 * `variantgroups`-driven `type` on `entities/humanoid/trader-{male,female}.json`) and the
 * trader's dialogue tree (`config/dialogue/trader.json`, a genuine branching state machine, not
 * flat flavor text) are both out of scope for v1 -- this only covers what's actually for sale.
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
      selling: normalizeListings(json.selling?.list ?? [], id, "selling"),
      buying: normalizeListings(json.buying?.list ?? [], id, "buying"),
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}
