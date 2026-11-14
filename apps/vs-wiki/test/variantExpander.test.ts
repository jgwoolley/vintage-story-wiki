import { test } from "node:test";
import assert from "node:assert/strict";
import { expandVariants } from "@nf3t/vs-wiki-core/variantExpander.js";
import type { AssetIndex, LoadedAsset } from "@nf3t/vs-wiki-core/types.js";

function index(...assets: Omit<LoadedAsset, "sourceFile">[]): AssetIndex {
  return new Map(assets.map((a) => [`${a.domain}:${a.relPath}`, { ...a, sourceFile: `/x/${a.domain}/${a.relPath}` }]));
}

const sides = { domain: "survival", relPath: "worldproperties/abstract/horizontalorientation.json", modid: "game", json: { code: "side", variants: [{ code: "north" }, { code: "south" }] } };

test("loadFromProperties: plain path, and a domain-prefixed one (a mod's \"game:abstract/...\")", () => {
  for (const loadFromProperties of ["abstract/horizontalorientation", "game:abstract/horizontalorientation"]) {
    const relic = { domain: "mymod", relPath: "blocktypes/relic.json", modid: "mymod", json: { code: "relic", variantgroups: [{ code: "type", states: ["a"] }, { code: "side", loadFromProperties }] } };
    const codes = expandVariants(index(sides, relic), ["blocktypes/"]).map((v) => v.code).sort();
    assert.deepEqual(codes, ["relic-a-north", "relic-a-south"], loadFromProperties);
  }
});
