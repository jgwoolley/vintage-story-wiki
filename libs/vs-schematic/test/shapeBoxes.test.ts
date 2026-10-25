import { test } from "node:test";
import assert from "node:assert/strict";
import { compactShape, shapeToBoxes } from "../src/shapeBoxes.js";

const face = (texture: string) => ({ north: { texture, uv: [0, 0, 1, 1] } });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("compactShape keeps geometry and the first textured face's key, drops faces/animations/bad elements", () => {
  const shape = compactShape({
    animations: [{ code: "walk" }],
    elements: [
      { name: "a", from: [0, 0, 0], to: [2, 4, 2], faces: { east: { texture: "#skin" } }, children: [{ from: [1, 1, 1], to: [2, 2, 2], faces: face("#fur") }, { from: "bad" }] },
      { from: [0, 0, 0] },
    ],
  });
  assert.equal(shape.elements.length, 1);
  assert.equal(shape.elements[0].texture, "skin");
  assert.equal(shape.elements[0].children?.length, 1);
  assert.equal(shape.elements[0].children?.[0].texture, "fur");
  assert.equal(compactShape(null).elements.length, 0);
});

test("an unrotated element becomes an axis-aligned box centered on its from/to", () => {
  const [box] = shapeToBoxes(compactShape({ elements: [{ from: [0, 0, 0], to: [4, 2, 6], faces: face("#a") }] }));
  assert.deepEqual([box.x, box.y, box.z, box.sx, box.sy, box.sz], [2, 1, 3, 4, 2, 6]);
  assert.equal(box.quaternion, undefined);
  assert.equal(box.texture, "a");
});

test("rotation is about rotationOrigin: a 90 degree turn about Y swings the box around the pivot", () => {
  const [box] = shapeToBoxes(compactShape({ elements: [{ from: [4, 0, 0], to: [6, 2, 2], rotationOrigin: [0, 0, 0], rotationY: 90, faces: face("#a") }] }));
  // center (5,1,1) rotated +90 degrees about Y -> (z, y, -x) = (1, 1, -5)
  near(box.x, 1); near(box.y, 1); near(box.z, -5);
  assert.ok(box.quaternion);
  near(box.quaternion![1], Math.SQRT1_2); near(box.quaternion![3], Math.SQRT1_2);
});

test("children inherit the parent's rotation about the parent's pivot; texture-less groups draw nothing", () => {
  const boxes = shapeToBoxes(compactShape({
    elements: [{ from: [0, 0, 0], to: [1, 1, 1], rotationOrigin: [0, 0, 0], rotationZ: 90, children: [{ from: [2, 0, 0], to: [4, 2, 2], faces: face("#c") }] }],
  }));
  assert.equal(boxes.length, 1, "the group itself has no faces");
  // child center (3,1,1) rotated +90 degrees about Z -> (-y, x, z) = (-1, 3, 1)
  near(boxes[0].x, -1); near(boxes[0].y, 3); near(boxes[0].z, 1);
});

test("a child's from and rotationOrigin are relative to its parent's from, as in the game's ShapeElement matrix", () => {
  const boxes = shapeToBoxes(compactShape({
    elements: [{ from: [10, 0, 0], to: [12, 2, 2], faces: face("#p"), children: [{ from: [1, 0, 0], to: [3, 2, 2], faces: face("#c") }] }],
  }));
  assert.deepEqual([boxes[1].x, boxes[1].y, boxes[1].z], [12, 1, 1], "child sits at parent.from + child.from");
});

test("a zero-thickness plane is given a sliver instead of vanishing", () => {
  const [box] = shapeToBoxes(compactShape({ elements: [{ from: [0, 0, 0], to: [4, 4, 0], faces: face("#a") }] }));
  assert.ok(box.sz > 0 && box.sz < 1);
});
