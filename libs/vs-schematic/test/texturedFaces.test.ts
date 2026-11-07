import { test } from "node:test";
import assert from "node:assert/strict";
import { compactShape, shapeToBoxes } from "../src/shapeBoxes.js";
import { buildFaceBuffers, quadIndices } from "../src/texturedFaces.js";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("compactShape keeps faces, uvs, rotations and texture sizes only when asked", () => {
  const raw = {
    textureWidth: 32,
    textureHeight: 16,
    textureSizes: { big: [64, 64], bad: [0, 1] },
    elements: [{
      from: [0, 0, 0], to: [4, 2, 6],
      faces: {
        north: { texture: "#a", uv: [0, 0, 4, 2], rotation: 450 },
        up: { texture: "#big" }, // no uv: the face's own size (x by z)
        down: { texture: "#a", enabled: false },
        south: { texture: 3 },
      },
    }],
  };
  assert.equal(compactShape(raw).elements[0].faces, undefined);
  assert.equal(compactShape(raw).textureSize, undefined);
  const shape = compactShape(raw, { faces: true });
  assert.deepEqual(shape.elements[0].faces, { north: { texture: "a", uv: [0, 0, 4, 2], rotation: 90 }, up: { texture: "big", uv: [0, 0, 4, 6] } });
  assert.deepEqual(shape.textureSize, [32, 16]);
  assert.deepEqual(shape.textureSizes, { big: [64, 64] });
  // UVs are normalized per texture: "a" by the shape's 32x16, "big" by its own 64x64.
  const [box] = shapeToBoxes(shape);
  assert.deepEqual(box.faces, [
    { side: "north", texture: "a", uv: [0, 0, 4 / 32, 2 / 16], rotation: 90 },
    { side: "up", texture: "big", uv: [0, 0, 4 / 64, 6 / 64] },
  ]);
});

test("a south face maps its uv top-left to the face's top-left as seen from outside, and its winding faces outward", () => {
  const box = { x: 0, y: 0, z: 0, sx: 2, sy: 2, sz: 2, faces: [{ side: "south" as const, texture: "t", uv: [0.25, 0.5, 0.75, 1] as [number, number, number, number] }] };
  const groups = buildFaceBuffers([{ box, index: 7, color: [1, 0, 0] }], () => true, { x: 0, y: 0, z: 0 });
  const g = groups.get("t")!;
  // Corners: top-left (-x, +y), top-right, bottom-right, bottom-left, all on z = +1.
  assert.deepEqual(g.positions, [-1, 1, 1, 1, 1, 1, 1, -1, 1, -1, -1, 1]);
  // three.js t = 1 - v: the image's top (v = 0.5) is t = 0.5.
  assert.deepEqual(g.uvs, [0.25, 0.5, 0.75, 0.5, 0.75, 0, 0.25, 0]);
  assert.deepEqual(g.normals.slice(0, 3), [0, 0, 1]);
  assert.deepEqual(g.colors.slice(0, 3), [1, 1, 1]); // textured faces aren't tinted
  assert.deepEqual(g.triangleVoxels, [7, 7]);
  // First triangle (top-left, bottom-left, bottom-right) is counter-clockwise seen from +z.
  const [a, b, c] = quadIndices(1).slice(0, 3).map((i) => [g.positions[i * 3], g.positions[i * 3 + 1]]);
  near((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), 4);
});

test("a 90 degree rotation shows the image's bottom-left at the face's top-left; missing textures go plain in the box color", () => {
  const faces = [
    { side: "up" as const, texture: "t", uv: [0, 0, 1, 1] as [number, number, number, number], rotation: 90 },
    { side: "down" as const, texture: "gone", uv: [0, 0, 0.5, 0.5] as [number, number, number, number] },
  ];
  const groups = buildFaceBuffers([{ box: { x: 5, y: 0, z: 0, faces }, index: 0, color: [0.2, 0.4, 0.6] }], (t) => t === "t", { x: 5, y: 0, z: 0 });
  // Image bottom-left (u 0, v 1) -> three (0, 0).
  assert.deepEqual(groups.get("t")!.uvs.slice(0, 2), [0, 0]);
  const plain = groups.get("")!;
  assert.deepEqual(plain.uvs, [0, 1, 1, 1, 1, 0, 0, 0]); // the whole edge tile, not the face's uv
  assert.deepEqual(plain.colors.slice(0, 3), [0.2, 0.4, 0.6]);
  assert.deepEqual(plain.positions.slice(0, 3), [-0.5, -0.5, 0.5]); // centered by the offset
});

test("a rotated box rotates its face positions and normals", () => {
  const s = Math.SQRT1_2;
  const box = { x: 0, y: 0, z: 0, quaternion: [0, s, 0, s] as [number, number, number, number], faces: [{ side: "south" as const, texture: "t", uv: [0, 0, 1, 1] as [number, number, number, number] }] };
  const g = buildFaceBuffers([{ box, index: 0, color: [1, 1, 1] }], () => true, { x: 0, y: 0, z: 0 }).get("t")!;
  // 90 degrees about y turns +z into +x.
  near(g.normals[0], 1);
  near(g.normals[2], 0);
});
