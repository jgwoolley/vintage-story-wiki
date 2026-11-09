// The pure parts of scenes (`vsdev screenshots` "scene"): moving boxes, the hand placement, element frames, and the type lookup helpers.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { compactShape, elementFrame, holdInHand, rotationMatrix, shapeToBoxes, transformBoxes, ITEM_HAND_TRANSFORM } from "@nf3t/vs-schematic/shapeBoxes.js";
import { byType, disabledElements, fill, findCollectible, handTransform, shapeRef, textureRefs } from "../src/render/collectible.js";
import { readShots } from "../src/commands/screenshots.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("transformBoxes: rotation about Y, scale and translation of a box center", () => {
  const [b] = transformBoxes([{ x: 4, y: 0, z: 0, sx: 2, sy: 2, sz: 2 }], rotationMatrix(0, 90, 0), [1, 2, 3], 2);
  // (4,0,0) scaled to (8,0,0), turned 90 degrees about Y -> (0,0,-8), then moved.
  near(b.x, 1); near(b.y, 2); near(b.z, -5);
  assert.equal(b.sx, 4);
  assert.ok(b.quaternion, "the rotation is kept on the box");
});

test("elementFrame finds a posed element's corner, shapeToBoxes agrees", () => {
  const shape = compactShape({
    elements: [{ name: "a", from: [0, 0, 0], to: [1, 1, 1], rotationOrigin: [0, 0, 0], children: [{ name: "b", from: [2, 0, 0], to: [3, 1, 1], faces: { north: { texture: "#t", uv: [0, 0, 1, 1] } } }] }],
  });
  const rest = elementFrame(shape, "b")!;
  assert.deepEqual(rest.t.map(Math.round), [2, 0, 0]);
  const turned = elementFrame(shape, "b", { a: { ry: 90 } })!;
  assert.deepEqual(turned.t.map((n) => Math.round(n)), [0, 0, -2], "the child follows its turned parent");
  assert.equal(elementFrame(shape, "nope"), undefined);
  assert.equal(shapeToBoxes(shape).length, 1, "only the textured child draws, a plain group does not");
});

test("holdInHand with a neutral transform puts the item at the anchor", () => {
  const anchor = { r: rotationMatrix(0, 0, 0), t: [10, 20, 30] as [number, number, number] };
  const neutral = { translation: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: 1, origin: [0, 0, 0] as [number, number, number] };
  const [b] = holdInHand([{ x: 1, y: 2, z: 3, sx: 1, sy: 1, sz: 1 }], anchor, { pos: [0, 0, 0], rot: [0, 0, 0] }, neutral);
  near(b.x, 11); near(b.y, 22); near(b.z, 33);
  // The game's default item hand transform shrinks to a third: a box one unit wide becomes ~0.33.
  const [small] = holdInHand([{ x: 0, y: 0, z: 0, sx: 3, sy: 3, sz: 3 }], anchor, { pos: [0, 0, 0], rot: [0, 0, 0] }, ITEM_HAND_TRANSFORM);
  near(small.sx, 0.99);
});

test("type lookup: glob keys pick the most specific, placeholders fill, hand transforms layer over the default", () => {
  assert.equal(byType({ "a-*": 1, "a-b-*": 2 }, "a-b-c"), 2);
  assert.equal(byType({ "a-*": 1 }, "z"), undefined);
  assert.equal(fill("x/{metal}/{nope}", { metal: "iron" }), "x/iron/{nope}");

  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-scene-"));
  try {
    mkdirSync(path.join(dir, "survival/itemtypes/part"), { recursive: true });
    writeFileSync(path.join(dir, "survival/itemtypes/part/rod.json"), `{
      code: "rod", variantgroups: [{ code: "metal", states: ["iron", "cupronickel"] }],
      shape: { base: "item/rod" }, textures: { metal: { base: "block/metal/ingot/{metal}" } },
      attributes: { disableElementsByType: { "rod-iron": ["Hair"] } },
      tpHandTransform: { scale: 2, translation: { x: 1 } },
    }`);
    const rod = findCollectible(dir, "rod-cupronickel")!;
    assert.equal(rod.kind, "item");
    assert.deepEqual(rod.groupValues, { metal: "cupronickel" });
    assert.deepEqual(shapeRef(rod), { domain: "survival", path: "item/rod" });
    assert.deepEqual(textureRefs(rod), { metal: "survival:block/metal/ingot/cupronickel" });
    assert.deepEqual(disabledElements(findCollectible(dir, "rod-iron")!), ["hair"]);
    assert.deepEqual(disabledElements(rod), []);
    const hand = handTransform(rod);
    assert.equal(hand.scale, 2);
    assert.deepEqual(hand.translation, [1, ITEM_HAND_TRANSFORM.translation[1], ITEM_HAND_TRANSFORM.translation[2]]);
    assert.equal(findCollectible(dir, "rod-gold"), undefined, "only listed states exist");
    assert.equal(findCollectible(dir, "spear-iron"), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("screenshots: scene entries are checked", () => {
  const ok = readShots({ screenshots: [{ name: "s", scene: [{ model: "a:b.json", at: [0, 0, 0] }, { player: { wear: ["x"] }, facing: "west" }] }] }, "m.json");
  assert.equal(ok.length, 1);
  assert.throws(() => readShots({ screenshots: [{ name: "s", scene: [] }] }, "m.json"), /list of parts/);
  assert.throws(() => readShots({ screenshots: [{ name: "s", scene: [{ at: [0, 0, 0] }] }] }, "m.json"), /model.*player/);
  assert.throws(() => readShots({ screenshots: [{ name: "s", scene: [{ model: "m", at: [0, 0] }] }] }, "m.json"), /\.at/);
  assert.throws(() => readShots({ screenshots: [{ name: "s", scene: [{ player: {}, facing: "up" }] }] }, "m.json"), /facing/);
  assert.throws(() => readShots({ screenshots: [{ name: "s", model: "m", scene: [{ model: "m" }] }] }, "m.json"), /exactly one/);
});
