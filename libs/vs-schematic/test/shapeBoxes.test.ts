import { test } from "node:test";
import assert from "node:assert/strict";
import { attachToBase, looksLikeShape, samplePose, compactShape, shapeToBoxes } from "../src/shapeBoxes.js";

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

test("attachToBase hangs worn elements under the named body element and draws only the worn ones", () => {
  const base = compactShape({ elements: [{ name: "Torso", from: [10, 20, 30], to: [14, 30, 34], faces: face("#skin"), children: [{ name: "Arm", from: [4, 0, 0], to: [6, 8, 2], faces: face("#skin") }] }] });
  const worn = compactShape({ elements: [{ name: "Plate", stepParentName: "Arm", from: [1, 1, 1], to: [3, 3, 3], faces: face("#metal") }, { name: "Loose", stepParentName: "Missing", from: [0, 0, 0], to: [1, 1, 1], faces: face("#metal") }] });
  const boxes = shapeToBoxes(attachToBase(worn, base));
  assert.equal(boxes.length, 2, "the body's own boxes are not drawn");
  // Plate: Torso.from + Arm.from + Plate.from + half size = (10+4+1+1, 20+0+1+1, 30+0+1+1)
  assert.deepEqual([boxes[0].x, boxes[0].y, boxes[0].z], [16, 22, 32]);
  assert.deepEqual([boxes[1].x, boxes[1].y, boxes[1].z], [0.5, 0.5, 0.5], "an element whose parent is missing stays where it is");
  assert.equal(attachToBase(base, base), base, "shapes without step parents are returned unchanged");
});

test("looksLikeShape tells a model file from a schematic and from other JSON", () => {
  assert.equal(looksLikeShape({ elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] }), true);
  assert.equal(looksLikeShape({ Indices: [1], BlockIds: [0], BlockCodes: {}, elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] }), false);
  assert.equal(looksLikeShape({ elements: [] }), false);
  assert.equal(looksLikeShape({ code: "x" }), false);
  assert.equal(looksLikeShape(null), false);
});

const arm = { name: "Arm", from: [0, 0, 0], to: [2, 2, 2], faces: face("#a") };

test("a pose adds to an element's rotation and moves it inside its rotated frame", () => {
  const shape = compactShape({ elements: [arm] });
  const [rest] = shapeToBoxes(shape);
  assert.deepEqual([rest.x, rest.y, rest.z], [1, 1, 1]);
  const [turned] = shapeToBoxes(shape, { Arm: { rz: 90 } });
  near(turned.x, -1); near(turned.y, 1); near(turned.z, 1); // (1,1,1) about the origin, +90 degrees around Z
  const [moved] = shapeToBoxes(shape, { Arm: { ox: 3, oy: -1 } });
  assert.deepEqual([moved.x, moved.y, moved.z], [4, 0, 1]);
  const [other] = shapeToBoxes(shape, { Leg: { rz: 90 } });
  assert.deepEqual([other.x, other.y, other.z], [1, 1, 1], "poses for other elements change nothing");
});

test("compactShape keeps animations compactly and samplePose interpolates and wraps them", () => {
  const shape = compactShape({
    elements: [arm],
    animations: [
      { code: "wave", name: "wave", quantityframes: 10, onAnimationEnd: "Repeat", keyframes: [
        { frame: 0, elements: { Arm: { rotationX: 0, rotationZ: 0.004, offsetX: 0 } } },
        { frame: 5, elements: { Arm: { rotationZ: 90, offsetX: 4 } } },
      ] },
      { code: "slide", quantityframes: 4, onAnimationEnd: "Stop", keyframes: [{ frame: 0, elements: { Arm: {} } }, { frame: 4, elements: { Arm: { offsetY: 8 } } }] },
      { code: "bad", quantityframes: 4, version: 1, keyframes: [{ frame: 0, elements: {} }] },
    ],
  });
  assert.deepEqual(shape.animations!.map((a) => a.code), ["wave", "slide"], "newer-version animations are skipped");
  assert.equal(shape.animations![0].name, undefined, "a name equal to the code is dropped");
  assert.deepEqual(shape.animations![0].keyframes[0].elements.Arm, {}, "zeros and sub-hundredth noise are dropped");
  const [wave, slide] = shape.animations!;
  assert.deepEqual(samplePose(wave, 0).Arm, {});
  assert.deepEqual(samplePose(wave, 2.5).Arm, { rz: 45, ox: 2 });
  assert.deepEqual(samplePose(wave, 7.5).Arm, { rz: 45, ox: 2 }, "a looping animation returns to its first keyframe");
  assert.deepEqual(samplePose(wave, 12.5).Arm, { rz: 45, ox: 2 }, "and wraps past its length");
  assert.deepEqual(samplePose(slide, 2).Arm, { oy: 4 });
  assert.deepEqual(samplePose(slide, 99).Arm, { oy: 8 }, "a non-looping animation holds its last pose");
});
