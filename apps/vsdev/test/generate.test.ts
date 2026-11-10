// vsdev texture / vsdev shape: the PNG codec, the painter (determinism, tiling, coverage, pixel art, masks, custom layers, errors), the
// shape builder (UVs, mirror, repeat, relief, texture keys, prune), the spec helpers (bar, prism, scaled, texturesFor, project, statue,
// gameShape), inventory icon transforms, and both commands end to end.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/main.js";
import { decodePng, encodePng } from "../src/gen/png.js";
import { loadSpec, SpecError } from "../src/gen/spec.js";
import { buildShape, mirrorElement } from "../src/shape/build.js";
import { animationPose, gameShape, setGameDir, statue } from "../src/shape/game.js";
import { guiTransform, writeGuiTransforms } from "../src/shape/gui.js";
import { aim, bar, prism, scaled, texturesFor } from "../src/shape/helpers.js";
import { project } from "../src/shape/project.js";
import { mirrorRows, paintTexture, parseColor, tilingNoise, rng, type TextureLayer } from "../src/texture/paint.js";

const paint = (layers: TextureLayer[], size: number | number[] = 8, seed = 1, colors = {}) => paintTexture({ size, seed, layers }, colors, "t");
const pixel = (img: { width: number; data: Uint8Array }, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test("png: encode then decode gives the same pixels", () => {
  const img = paint([{ type: "fill", color: "#102030" }, { type: "grain", amount: 0.3 }, { type: "fill", color: "#ff000080", region: [0, 0, 2, 2] }], [5, 3]);
  const back = decodePng(encodePng(img));
  assert.equal(back.width, 5);
  assert.equal(back.height, 3);
  assert.deepEqual([...back.data], [...img.data]);
});

test("colors: hex forms, arrays, names, transparent; unknown names are errors", () => {
  assert.deepEqual(parseColor("#abc", {}, "w"), [0xaa, 0xbb, 0xcc, 255]);
  assert.deepEqual(parseColor("#01020304", {}, "w"), [1, 2, 3, 4]);
  assert.deepEqual(parseColor([1, 2, 3], {}, "w"), [1, 2, 3, 255]);
  assert.deepEqual(parseColor("a", { a: "b", b: "#000000" }, "w"), [0, 0, 0, 255]);
  assert.deepEqual(parseColor("transparent", {}, "w"), [0, 0, 0, 0]);
  assert.throws(() => parseColor("nope", { a: "#fff" }, "w"), /unknown color "nope".*named colors: a/);
});

test("paint: same spec, same pixels; another seed, other pixels", () => {
  const layers: TextureLayer[] = [{ type: "fill", color: "#808080" }, { type: "noise", color: "#000000", scale: 2 }, { type: "speckle", shade: 0.5, density: 0.2 }];
  assert.deepEqual([...paint(layers).data], [...paint(layers).data]);
  assert.notDeepEqual([...paint(layers).data], [...paint(layers, 8, 2).data]);
});

test("noise: equalized, so coverage paints that share of pixels; and it tiles", () => {
  const img = paint([{ type: "fill", color: "#ffffff" }, { type: "noise", color: "#000000", scale: 4, coverage: 0.25, softness: 0 }], 16);
  let dark = 0;
  for (let i = 0; i < 256; i++) if (img.data[i * 4] === 0) dark++;
  assert.equal(dark, 64);
  // Tiling: the step across the wrap (last column -> first) is no bigger than the largest step inside the texture.
  const n = tilingNoise(32, 32, 8, 1, rng(5));
  let inside = 0, wrap = 0;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 31; x++) inside = Math.max(inside, Math.abs(n[y * 32 + x + 1] - n[y * 32 + x]));
    wrap = Math.max(wrap, Math.abs(n[y * 32] - n[y * 32 + 31]));
  }
  assert.ok(wrap <= inside, `wrap step ${wrap} > inside step ${inside}`);
});

test("paint: region, shade, border, bevel", () => {
  const img = paint([{ type: "fill", color: "#646464" }, { type: "fill", color: "#ff0000", region: [2, 2, 2, 2] }, { type: "border", shade: 0.5 }]);
  assert.deepEqual(pixel(img, 2, 2), [255, 0, 0, 255]);
  assert.deepEqual(pixel(img, 4, 4), [100, 100, 100, 255]);
  assert.deepEqual(pixel(img, 0, 5), [50, 50, 50, 255]);
  const bev = paint([{ type: "fill", color: "#646464" }, { type: "bevel", light: 1.5, dark: 0.5 }]);
  assert.deepEqual(pixel(bev, 3, 0), [150, 150, 150, 255]);
  assert.deepEqual(pixel(bev, 3, 7), [50, 50, 50, 255]);
});

test("paint: pixel art with mirror, colors and shadow", () => {
  assert.deepEqual(mirrorRows(["ab", ".c"]), ["aba", ".c."]);
  const img = paint([{ type: "fill", color: "#ffffff" }, { type: "pixels", at: [1, 1], rows: ["#o"], mirror: true, colors: { "#": "#ff0000", o: "#0000ff" }, shadow: "#000000" }]);
  assert.deepEqual(pixel(img, 1, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(img, 2, 1), [0, 0, 255, 255]);
  assert.deepEqual(pixel(img, 3, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(img, 4, 2), [0, 0, 0, 255]);
  assert.deepEqual(pixel(img, 1, 2), [255, 255, 255, 255]);
});

test("paint: mistakes name the layer", () => {
  assert.throws(() => paint([{ type: "sparkle" as never }]), /layer 1 \(sparkle\): unknown layer type/);
  assert.throws(() => paint([{ type: "fill" }]), /layer 1 \(fill\): needs "color" or "shade"/);
  assert.throws(() => paint([{ type: "fill", color: "#fff", shade: 2 }]), /not both/);
  assert.throws(() => paint([{ type: "noise", color: "#fff", coverage: 2 }]), /"coverage" must be a number from 0 to 1/);
  assert.throws(() => paintTexture({ size: 0, layers: [] }, {}, "t"), /size must be/);
});

const textures = { m: "x:block/m", g: "x:block/g" };

test("shape: a box gets every face, UVs as big as each side, capped at the texture", () => {
  const { shape, unused } = buildShape({ textures, elements: [{ box: [[0, 0, 0], [20, 4, 2]], tex: "m", faces: { south: "g", down: false, up: { texture: "g", uv: "full" } } }] }, "s");
  const el = (shape.elements as Record<string, any>[])[0];
  assert.deepEqual(Object.keys(el.faces), ["north", "east", "south", "west", "up"]);
  assert.deepEqual(el.faces.north, { texture: "#m", uv: [0, 0, 16, 4] });
  assert.deepEqual(el.faces.east, { texture: "#m", uv: [0, 0, 2, 4] });
  assert.deepEqual(el.faces.south.texture, "#g");
  assert.deepEqual(el.faces.up.uv, [0, 0, 16, 16]);
  assert.deepEqual(unused, []);
});

test("shape: rot turns about the box center unless origin is given; joints carry children", () => {
  const { shape } = buildShape({ textures, elements: [{ box: [[0, 0, 0], [2, 2, 2]], tex: "m", rot: [0, 45, 0] }, { joint: [8, 8, 8], rot: [10, 0, 0], children: [{ box: [[0, 0, 0], [1, 1, 1]], tex: "m" }] }] }, "s");
  const [b, j] = shape.elements as Record<string, any>[];
  assert.deepEqual([b.rotationOrigin, b.rotationY, b.rotationX], [[1, 1, 1], 45, undefined]);
  assert.deepEqual([j.from, j.to, j.rotationOrigin, j.rotationX, j.faces], [[8, 8, 8], [8, 8, 8], [8, 8, 8], 10, {}]);
  assert.equal(j.children[0].name, "box-2");
});

test("shape: mirror copies across x = 8, swapping left/right, east/west and the turn", () => {
  const { shape } = buildShape({ textures, elements: [{ mirror: { box: [[1, 0, 0], [3, 1, 1]], tex: "m", name: "armLeft", rot: [0, 30, 0], faces: { east: "g" } } }] }, "s");
  const [a, b] = shape.elements as Record<string, any>[];
  assert.equal(a.name, "armLeft");
  assert.equal(b.name, "armRight");
  assert.deepEqual([b.from, b.to, b.rotationOrigin, b.rotationY], [[13, 0, 0], [15, 1, 1], [14, 0.5, 0.5], -30]);
  assert.equal(b.faces.west.texture, "#g");
  assert.equal(b.faces.east.texture, "#m");
  // Children mirror across their parent's middle, so the parent's own mirrored frame lines them up again.
  const child = mirrorElement({ name: "p", from: [0, 0, 0], to: [4, 1, 1], children: [{ name: "c", from: [0, 0, 0], to: [1, 1, 1] }] }, "x", 8) as Record<string, any>;
  assert.deepEqual([child.from, child.children[0].from, child.children[0].to], [[12, 0, 0], [3, 0, 0], [4, 1, 1]]);
});

test("shape: repeat steps copies with unique names; relief makes one box per run", () => {
  const { shape } = buildShape({ textures, elements: [
    { repeat: 3, step: [0, 2, 0], of: { box: [[0, 0, 0], [1, 1, 1]], tex: "m", name: "rung" } },
    { relief: ["##.#", ".##."], at: [0, 10, 5], cell: 2, depth: 1, tex: "g", name: "art" },
  ] }, "s");
  const els = shape.elements as Record<string, any>[];
  assert.deepEqual(els.slice(0, 3).map((e) => [e.name, e.from[1]]), [["rung", 0], ["rung-2", 2], ["rung-3", 4]]);
  assert.deepEqual(els.slice(3).map((e) => [e.from, e.to]), [[[0, 8, 4], [4, 10, 5]], [[6, 8, 4], [8, 10, 5]], [[2, 6, 4], [6, 8, 5]]]);
});

test("shape: bounds follow turns and parents; ground rests a piece, or the whole shape, on y = 0", () => {
  const near = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-3, `${a} vs ${b}`));
  // A 2 x 8 x 2 post turned 90 degrees about z through its foot lies down toward -x (x right, y up: +y turns to -x).
  const lying = buildShape({ textures, elements: [{ box: [[4, 0, 4], [6, 8, 6]], tex: "m", rot: [0, 0, 90], origin: [4, 0, 4] }] }, "s");
  near(lying.bounds!.min, [-4, 0, 4]);
  near(lying.bounds!.max, [4, 2, 6]);
  // A child is placed in its parent's turned frame; an empty joint adds nothing of its own.
  const held = buildShape({ textures, elements: [{ joint: [8, 5, 8], rot: [0, 0, 90], children: [{ box: [[0, 0, 0], [4, 1, 1]], tex: "m" }] }] }, "s");
  near(held.bounds!.min, [7, 5, 8]);
  near(held.bounds!.max, [8, 9, 9]);
  assert.equal(buildShape({ textures: {}, elements: [{ joint: [1, 1, 1] }] }, "s").bounds, undefined);

  // A cube tipped onto its edge sinks by (sqrt(2) - 1) / 2 of its size: ground lifts it back; the other piece stays where it is.
  const { shape, bounds } = buildShape({ textures, elements: [
    { box: [[0, 0, 0], [4, 4, 4]], tex: "m", rot: [45, 0, 0], ground: true, name: "tipped" },
    { box: [[10, 3, 10], [11, 4, 11]], tex: "m", name: "floating" },
  ] }, "s");
  const [tipped, floating] = shape.elements as Record<string, any>[];
  near([tipped.from[1], tipped.rotationOrigin[1]], [0.8284, 2.8284]);
  assert.equal(floating.from[1], 3);
  assert.equal("__ground" in tipped, false);
  near([bounds!.min[1]], [0]);
  const whole = buildShape({ textures, ground: true, elements: [{ box: [[0, 3, 0], [1, 4, 1]], tex: "m" }, { box: [[0, 5, 0], [1, 6, 1]], tex: "m" }] }, "s");
  assert.deepEqual((whole.shape.elements as Record<string, any>[]).map((e) => e.from[1]), [0, 2]);
  assert.throws(() => buildShape({ textures, elements: [{ joint: [0, 0, 0], children: [{ box: [[0, 0, 0], [1, 1, 1]], tex: "m", ground: true, name: "kid" }] }] }, "s"),
    /"ground" on "kid" does nothing: it is a child/);
});

test("shape: a texture key not in textures is an error; unused keys are reported; game JSON passes through", () => {
  assert.throws(() => buildShape({ textures, elements: [{ box: [[0, 0, 0], [1, 1, 1]], tex: "nope" }] }, "s"), (e: Error) => e instanceof SpecError && /texture "nope" is not in "textures" \(m, g\)/.test(e.message));
  const raw = { name: "raw", from: [0, 0, 0], to: [1, 1, 1], faces: { north: { texture: "#m", uv: [0, 0, 1, 1] } }, shade: false };
  const { shape, unused } = buildShape({ textures, elements: [raw] }, "s");
  assert.deepEqual((shape.elements as unknown[])[0], raw);
  assert.deepEqual(unused, ["g"]);
});

test("spec: a JS module's default function gets the helpers", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-gen-"));
  try {
    writeFileSync(path.join(dir, "s.mjs"), "export default ({ box, mirrorRows }) => ({ shapes: { a: { textures: { m: 'x:m' }, elements: [box([0,0,0],[1,1,1],'m')] } }, rows: mirrorRows(['ab']) });");
    const spec = await loadSpec(path.join(dir, "s.mjs"), { box: (f: unknown, t: unknown, tex: string) => ({ box: [f, t], tex }), mirrorRows });
    assert.deepEqual(spec.rows, ["aba"]);
    assert.deepEqual((spec.shapes as any).a.elements[0], { box: [[0, 0, 0], [1, 1, 1]], tex: "m" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vsdev texture and vsdev shape write their files; a bad spec is a clear error", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-gen-"));
  const log = console.log, err = console.error;
  const errors: string[] = [];
  console.log = () => {};
  console.error = (m: string) => errors.push(String(m));
  try {
    writeFileSync(path.join(dir, "t.json"), JSON.stringify({ out: "tex", textures: { "a/b": { size: 4, layers: [{ type: "fill", color: "#123456" }] } } }));
    assert.equal(await main(["texture", path.join(dir, "t.json"), "--no-preview"]), 0);
    assert.deepEqual(pixel(decodePng(readFileSync(path.join(dir, "tex/a/b.png"))), 3, 3), [0x12, 0x34, 0x56, 255]);
    writeFileSync(path.join(dir, "s.json"), "{ shapes: { thing: { textures: { m: 'x:m' }, elements: [{ box: [[0,0,0],[16,16,16]], tex: 'm' }] } } } // json5");
    assert.equal(await main(["shape", path.join(dir, "s.json"), "--out", path.join(dir, "shapes")]), 0);
    assert.equal(JSON.parse(readFileSync(path.join(dir, "shapes/thing.json"), "utf8")).elements.length, 1);
    assert.equal(await main(["shape", path.join(dir, "s.json"), "--out", dir, "--dry-run", "--only", "nothing"]), 1);
    assert.match(errors.at(-1)!, /no shape matches --only nothing \(there are: thing\)/);
    assert.equal(await main(["shape", path.join(dir, "s.json")]), 1);
    assert.match(errors.at(-1)!, /say where the files go/);
    writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ out: ".", textures: { x: { layers: [{ type: "fill" }] } } }));
    assert.equal(await main(["texture", path.join(dir, "bad.json"), "--dry-run"]), 1);
    assert.match(errors.at(-1)!, /bad\.json: texture "x" layer 1 \(fill\): needs "color" or "shade"/);
    assert.equal(existsSync(path.join(dir, "x.png")), false);
  } finally {
    console.log = log;
    console.error = err;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- The helpers for hand-built models: bar, prism, scaled, texturesFor, prune, icons, masks, custom layers, projection, statues.

test("bar: a box from one point to another, whatever the direction", () => {
  const near = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 0.03, `${a} vs ${b}`));
  for (const to of [[4, 9, 2], [-3, 2, 6], [2, 2, -5], [0, -4, 0]] as [number, number, number][]) {
    const { bounds } = buildShape({ textures, elements: [bar([1, 2, 3], to, 0.02, "m")] }, "s");
    // A thin bar's bounds are the box spanned by its two ends.
    near(bounds!.min, [1, 2, 3].map((v, i) => Math.min(v, to[i]) - 0.02));
    near(bounds!.max, [1, 2, 3].map((v, i) => Math.max(v, to[i]) + 0.02));
  }
  assert.deepEqual(aim([0, 1, 0]), [0, 0, 0]);
  assert.throws(() => aim([0, 0, 0]), /can't be \[0, 0, 0\]/);
});

test("prism: n flat panels round a core, really n-sided; panels can lean and carry elements", () => {
  const els = prism({ apothem: 4, y: [0, 3], tex: "m" });
  assert.equal(els.length, 9);
  const { bounds } = buildShape({ textures, elements: els }, "s");
  // An octagon of apothem 4 reaches 4 along the axes (not 4 * sqrt(2), as a box and its 45 degree copy would).
  assert.ok(Math.abs(bounds!.max[0] - 12) < 0.05 && Math.abs(bounds!.max[2] - 12) < 0.05, JSON.stringify(bounds));
  const leaning = prism({ apothem: 4, y: [0, 3], sides: 6, lean: 10, core: false, tex: "m", panel: (i) => (i === 0 ? [{ box: [[-0.5, 1, 0], [0.5, 2, 1]], tex: "g", name: "stud" }] : []) });
  assert.equal(leaning.length, 6);
  const built = buildShape({ textures, elements: leaning }, "s");
  assert.equal(JSON.stringify(built.shape).match(/"stud"/g)?.length, 1);
  assert.ok(built.bounds!.max[1] < 3.01, "leaning panels end at the top");
  assert.throws(() => prism({ apothem: 4, y: [0, 3], sides: 2, tex: "m" }), /3 or more/);
});

test("scaled and texturesFor; prune leaves unused texture keys out", () => {
  const big = scaled(2, [{ box: [[0, 0, 0], [1, 2, 3]], tex: "m", origin: [1, 1, 1] }, { joint: [1, 1, 1], children: [{ relief: ["#"], at: [0, 1, 0], cell: 0.5, depth: 0.25, tex: "g" }] }]) as any[];
  assert.deepEqual([big[0].box, big[0].origin, big[1].joint, big[1].children[0].at, big[1].children[0].cell, big[1].children[0].depth], [[[0, 0, 0], [2, 4, 6]], [2, 2, 2], [2, 2, 2], [0, 2, 0], 1, 0.5]);
  assert.deepEqual(texturesFor({ m: "a", g: "b", h: "c" }, [{ tex: "m" }, { faces: { north: { texture: "#h" } } }]), { m: "a", h: "c" });
  const pruned = buildShape({ textures, prune: true, elements: [{ box: [[0, 0, 0], [1, 1, 1]], tex: "m" }] }, "s");
  assert.deepEqual([pruned.shape.textures, pruned.unused], [{ m: "x:block/m" }, []]);
});

test("gui: icon transforms from bounds, written into a blocktype one line per key", () => {
  const t = guiTransform({ min: [0, 0, 4], max: [16, 8, 12] }, { rotateY: 180 });
  assert.deepEqual([t.origin, t.scale], [{ x: 0.5, y: 0.25, z: 0.5 }, 0.95]);
  const off = guiTransform({ min: [0, 0, 0], max: [8, 8, 8] }, { rotateY: 180 });
  assert.deepEqual([off.origin.x, off.origin.z, off.scale], [0.75, 0.75, 1.1]);
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-gui-"));
  try {
    const file = path.join(dir, "b.json");
    writeFileSync(file, '{\n  "code": "b",\n  "guiTransformByType": {\n    "*-old-*": { "rotation": { "x": 1, "y": 2, "z": 3 }, "origin": { "x": 0, "y": 0, "z": 0 }, "scale": 1 }\n  },\n  "x": 1\n}\n');
    const r = writeGuiTransforms(file, [["*-old-*", t], ["*-new-*", off]]);
    assert.deepEqual(r, { added: ["*-new-*"], changed: ["*-old-*"] });
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(parsed.guiTransformByType["*-old-*"].rotation, { x: 1, y: 2, z: 3 }, "an existing line keeps its rotation");
    assert.deepEqual(parsed.guiTransformByType["*-old-*"].origin, t.origin);
    assert.equal(parsed.guiTransformByType["*-new-*"].scale, 1.1);
    assert.deepEqual(writeGuiTransforms(file, [["*-new-*", off]]), { added: [], changed: [] });
    // keepScale: an existing entry keeps the scale tuned by eye, only the origin moves.
    writeGuiTransforms(file, [["*-new-*", { ...off, origin: { x: 0.1, y: 0.2, z: 0.3 }, scale: 0.5 }]], { keepScale: true });
    const kept = JSON.parse(readFileSync(file, "utf8")).guiTransformByType["*-new-*"];
    assert.deepEqual([kept.origin, kept.scale], [{ x: 0.1, y: 0.2, z: 0.3 }, 1.1]);
    writeFileSync(file, '{ "code": "b" }');
    assert.throws(() => writeGuiTransforms(file, [["k", t]]), /no "guiTransformByType"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("paint: a mask (pixel art or a function) limits any layer; a custom layer draws with code", () => {
  const masked = paint([{ type: "fill", color: "#000000" }, { type: "fill", color: "#ffffff", mask: { rows: ["#.", ".#"], at: [1, 1], scale: 2 } }]);
  assert.deepEqual([pixel(masked, 1, 1), pixel(masked, 3, 1), pixel(masked, 3, 3), pixel(masked, 0, 0)].map((p) => p[0]), [255, 0, 255, 0]);
  const half = paint([{ type: "fill", color: "#000000" }, { type: "fill", color: "#ffffff", mask: (x: number) => (x < 4 ? 1 : 0) }]);
  assert.deepEqual([pixel(half, 3, 5)[0], pixel(half, 4, 5)[0]], [255, 0]);
  const custom = paint([{ type: "fill", color: "#000000" }, { type: "custom", color: "#ff0000", draw: (c: any) => {
    c.set(0, 0, "#00ff00");
    c.paint(1, 0, 1);
    c.paint(2, 0, 1, "#0000ff");
    c.shade(0, 0, 1, 0.5);
    assert.equal(c.noise(4).length, c.width * c.height);
    assert.deepEqual(c.get(1, 0), [255, 0, 0, 255]);
  } } as TextureLayer]);
  assert.deepEqual([pixel(custom, 0, 0), pixel(custom, 1, 0), pixel(custom, 2, 0)], [[0, 128, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255]]);
  assert.throws(() => paint([{ type: "custom" }]), /needs "draw"/);
  assert.throws(() => paint([{ type: "fill", color: "#fff", mask: { rows: 3 } as never }]), /"mask" is/);
});

test("project: a model seen straight on, as pixel rows", () => {
  // A 4 x 4 plate with a 2 x 2 block in front of its lower left quarter.
  const spec = { textures, elements: [{ box: [[0, 0, 0], [4, 4, 1]], tex: "m" }, { box: [[0, 0, 1], [2, 2, 2]], tex: "g" }] };
  const p = project(spec, { width: 4 });
  assert.deepEqual([p.width, p.height], [4, 4]);
  assert.deepEqual(p.rows((h) => (h?.texture === "g" ? "g" : h ? "m" : undefined)), ["mmmm", "mmmm", "ggmm", "ggmm"]);
  const hit = p.at(3, 0)!;
  assert.equal(hit.texture, "m");
  assert.ok(hit.u > 0.75 && hit.v > 0.75, `${hit.u} ${hit.v}`);
  // From the east (looking west, south is on the left): the plate's east edge on the right, the block's below it on the left.
  assert.deepEqual(project(spec, { width: 2, side: "east" }).rows((h) => h?.texture), [".m", ".m", "gm", "gm"]);
});

test("statue: a game shape posed by one of its keyframes, in one material, scaled, trimmed, with additions", () => {
  const shape = {
    elements: [{ name: "body", from: [0, 0, 0], to: [2, 4, 2], rotationOrigin: [1, 0, 1], children: [
      { name: "arm", from: [2, 2, 0], to: [3, 4, 1], rotationOrigin: [2, 4, 0], rotationZ: 5 },
      { name: "tool", from: [0, 0, 0], to: [1, 1, 1] },
    ] }],
    animations: [{ code: "wave", keyframes: [{ frame: 0, elements: { arm: { rotationZ: 10 }, body: { offsetY: 1 } } }, { frame: 5, elements: { arm: { rotationZ: 90 } } }] }],
  };
  const els = statue(shape, { animation: "wave", keyframe: 1, texture: "stone", scale: 2, drop: ["tool"], attach: { body: [{ box: [[0, 4, 0], [1, 5, 1]], tex: "stone", name: "wing" }] } }) as any[];
  const body = els[0], arm = body.children[0];
  assert.deepEqual([body.from, body.to], [[0, 2, 0], [4, 10, 4]]);
  assert.equal(arm.rotationZ, 95, "keyframe 1 for the arm (90) on top of its own turn (5)");
  assert.deepEqual(arm.faces.south, { texture: "#stone", uv: [0, 0, 2, 4] });
  assert.equal(body.children.length, 2);
  assert.deepEqual(body.children[1].box, [[0, 8, 0], [2, 10, 2]]);
  assert.deepEqual(animationPose(shape, "wave", 0), { arm: { rotationZ: 10 }, body: { offsetY: 1 } });
  assert.throws(() => statue(shape, { animation: "dance", texture: "s" }), /no animation "dance" \(it has: wave\)/);
  // Built like any other element: the attached box gets its faces.
  const { shape: built } = buildShape({ textures: { stone: "x:s" }, elements: els }, "s");
  assert.equal((built.elements as any[])[0].children[1].faces.north.texture, "#stone");
});

test("gameShape reads a shape from the game install (assets/game, survival or creative)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-game-"));
  try {
    mkdirSync(path.join(dir, "assets/survival/shapes/block"), { recursive: true });
    writeFileSync(path.join(dir, "assets/survival/shapes/block/thing.json"), "{ elements: [], // json5\n}");
    setGameDir(dir);
    assert.deepEqual(gameShape("block/thing").elements, []);
    assert.deepEqual(gameShape("game:block/thing.json").elements, []);
    assert.throws(() => gameShape("block/none"), /not found/);
  } finally {
    setGameDir(undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});
