import { test } from "node:test";
import assert from "node:assert/strict";
import { blockColor, parseBlockColors } from "../src/blockColors.js";
import { stringToColor } from "../src/schematicVoxels.js";

test("parseBlockColors keeps valid hex entries (BGR swapped to RGB, lowercased), ignores alpha and skips bad entries", () => {
  const colors = parseBlockColors({
    "game:rock-granite": { hex: "#ABCDEF", alpha: 0 },
    "game:bad": { hex: "red" },
    "game:none": {},
  });
  assert.deepEqual([...colors], [["game:rock-granite", "#efcdab"]]);
});

test("parseBlockColors rejects files that aren't a color map", () => {
  for (const bad of [null, [], "x", 3, {}, { a: { hex: "nope" } }]) assert.throws(() => parseBlockColors(bad), String(JSON.stringify(bad)));
});

test("blockColor uses the map, defaults the game: domain, and falls back to the hash color", () => {
  const colors = parseBlockColors({ "game:rock-granite": { hex: "#332211" } });
  assert.equal(blockColor("game:rock-granite", colors), "#112233");
  assert.equal(blockColor("rock-granite", colors), "#112233");
  assert.equal(blockColor("other:rock-granite", colors), stringToColor("other:rock-granite"));
  assert.equal(blockColor("game:missing", colors), stringToColor("game:missing"));
  assert.equal(blockColor("game:rock-granite", null), stringToColor("game:rock-granite"));
});
