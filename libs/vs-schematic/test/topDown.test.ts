import { test } from "node:test";
import assert from "node:assert/strict";
import { reliefShade, topDownView } from "../src/topDown.js";

test("each column shows its highest block and the view covers the occupied footprint", () => {
  const view = topDownView([
    { x: 2, y: 0, z: 5, code: "stone" },
    { x: 2, y: 3, z: 5, code: "roof" },
    { x: 4, y: 1, z: 6, code: "wall" },
  ])!;
  assert.deepEqual([view.width, view.depth, view.minX, view.minZ, view.minY, view.maxY], [3, 2, 2, 5, 0, 3]);
  assert.deepEqual(view.tops[0], { y: 3, code: "roof" });
  assert.equal(view.tops[1], undefined, "column (3, 5) is empty");
  assert.deepEqual(view.tops[5], { y: 1, code: "wall" });
  assert.equal(topDownView([]), null);
});

test("relief shading lights rises and shadows drops towards the north-west, and leaves the structure's edge flat", () => {
  const view = topDownView([
    { x: 0, y: 0, z: 0, code: "a" }, { x: 1, y: 0, z: 0, code: "a" }, { x: 2, y: 0, z: 0, code: "a" },
    { x: 0, y: 0, z: 1, code: "a" }, { x: 1, y: 3, z: 1, code: "a" }, { x: 2, y: 0, z: 1, code: "a" },
  ])!;
  assert.equal(reliefShade(view, 0, 0), 0, "nothing beyond the edge to compare with");
  assert.ok(reliefShade(view, 1, 1) > 0, "the bump faces the light");
  assert.equal(reliefShade(view, 2, 1), -1, "the cell behind the bump is in its shadow");
  assert.equal(reliefShade(view, 1, 0), 0);
});
