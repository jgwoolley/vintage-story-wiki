// The tools that tell an agent what is wrong with a model it made: the shape lint (`vsdev render --check`, src/shape/check.ts), the
// render aids (--grid, --color-by, --highlight, --hide, --sheet, --compare, the west/bottom views), `vsdev find`, and the builder's
// relative placement (place.ts), corners, bands, tapers, poses and mirror defaults.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { listAssets, matchAssets } from "../src/commands/find.js";
import { SpecError } from "../src/gen/spec.js";
import { main } from "../src/main.js";
import { appDir } from "../src/paths.js";
import { AXIS_LABELS, elementColor, elementPaths, guideBoxes, matchesElement, unmatchedPatterns } from "../src/render/aids.js";
import { parseArgs, type RenderOptions } from "../src/render/args.js";
import { compareShapes, renderFiles, RenderError } from "../src/render/render.js";
import { DEFAULT_VIEWS, SHEET_VIEWS, VIEW_NOTES, VIEWS, viewVector } from "../src/render/views.js";
import { buildShape } from "../src/shape/build.js";
import { checkShape, formatCheck } from "../src/shape/check.js";
import { scaled } from "../src/shape/helpers.js";

const noBrowser = !existsSync(chromium.executablePath()) && "no Playwright Chromium (npx playwright-core install chromium)";

type Json = Record<string, any>;
const SIDES = ["north", "east", "south", "west", "up", "down"];
/** A game-JSON element with all six faces in one texture. */
const el = (name: string, from: number[], to: number[], tex = "a", extra: Json = {}): Json => ({
  name, from, to, faces: Object.fromEntries(SIDES.map((s) => [s, { texture: `#${tex}`, uv: [0, 0, 1, 1] }])), ...extra,
});
const shapeOf = (...elements: Json[]) => ({ textures: { a: "block/a", b: "block/b" }, elements });
const codes = (raw: unknown, level?: string) => checkShape(raw).findings.filter((f) => !level || f.level === level).map((f) => f.code);

test("check: a clean model has bounds in units and blocks, every element's box by path, and no findings", () => {
  const c = checkShape(shapeOf(el("base", [0, 0, 0], [16, 4, 16]), el("post", [7, 4, 7], [9, 12, 9], "a", { children: [el("cap", [-1, 8, -1], [3, 9, 3])] })));
  assert.deepEqual(c.findings, []);
  assert.deepEqual([c.errors, c.warnings, c.notes], [0, 0, 0]);
  assert.deepEqual(c.bounds, { min: [0, 0, 0], max: [16, 13, 16] });
  assert.deepEqual(c.blocks, [1, 0.81, 1]);
  // A child's "from" is counted from its parent's "from": the cap is at 6..10, not -1..3.
  assert.deepEqual(c.elements.map((e) => [e.path, e.min, e.max]), [["base", [0, 0, 0], [16, 4, 16]], ["post", [7, 4, 7], [9, 12, 9]], ["post/cap", [6, 12, 6], [10, 13, 10]]]);
  assert.deepEqual(c.elements[2].size, [4, 1, 4]);
  assert.equal(c.elements[0].turned, false);
});

test("check: a part touching nothing is an error, unless it rests on the floor or reaches the block's edge", () => {
  const floating = checkShape(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("lid", [2, 8.5, 2], [14, 10, 14])));
  assert.deepEqual(floating.findings.map((f) => [f.level, f.code, f.elements]), [["error", "floating", ["lid"]]]);
  assert.match(floating.findings[0].message, /"lid" touches nothing else: 0\.5 from "body", lowest point y 8\.5\. Close the gap/);
  assert.equal(floating.errors, 1);
  // The classic slip: a child written in block coordinates lands far away, and the message says where to look.
  const frame = checkShape(shapeOf(el("body", [2, 0, 2], [6, 4, 6], "a", { children: [el("knob", [10, 4, 10], [11, 5, 11])] })));
  assert.match(frame.findings[0].message, /a child is placed from its parent's "from"/);
  // Touching (within 0.05) is joined; a loose piece on the floor and a wall piece at the block's side are not errors.
  assert.deepEqual(codes(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("lid", [2, 8.04, 2], [14, 10, 14]))), []);
  assert.deepEqual(codes(shapeOf(el("body", [2, 0, 2], [6, 8, 6]), el("pebble", [10, 0, 10], [11, 1, 11]))), []);
  assert.deepEqual(codes(shapeOf(el("body", [2, 0, 2], [6, 8, 6]), el("hook", [10, 9, 15], [11, 10, 16])), "error"), []);
  assert.deepEqual(codes(shapeOf(el("body", [2, 0, 2], [6, 8, 6]), el("hook", [10, 9, 15], [11, 10, 16])), "note"), ["floating"]);
  // A turned part is measured turned: this bar reaches the body only once it is rotated.
  const bar = (rotationZ: number) => shapeOf(el("body", [0, 0, 0], [4, 4, 4]), el("bar", [6, 3, 1], [7, 9, 2], "a", { rotationOrigin: [6.5, 3, 1.5], rotationZ }));
  assert.deepEqual(codes(bar(0), "error"), ["floating"]);
  assert.deepEqual(codes(bar(90), "error"), []);
});

test("check: faces in one plane flicker when their textures differ, and are a note when they don't", () => {
  // A band flush with the body's south face.
  const flush = checkShape(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("band", [5, 0, 13], [7, 8, 14], "b")));
  const coplanar = flush.findings.filter((f) => f.code === "coplanar");
  assert.equal(coplanar.length, 1);
  assert.equal(coplanar[0].level, "warning");
  assert.deepEqual(coplanar[0].elements, ["body", "band"]);
  assert.match(coplanar[0].message, /south/);
  // Standing 0.25 proud, it is fine.
  assert.deepEqual(codes(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("band", [5, 0.5, 13], [7, 7.5, 14.25], "b")), "warning"), []);
  // The same texture is only counted.
  const same = checkShape(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("band", [5, 0.5, 13], [7, 7.5, 14], "a")));
  assert.deepEqual(same.findings.map((f) => [f.level, f.code]), [["note", "same-texture"], ["note", "inside"]]);
});

test("check: flat parts in a face, parts with no size, UVs off the texture, unknown texture keys", () => {
  const flat = checkShape(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("label", [5, 2, 14], [9, 6, 14], "b")));
  assert.deepEqual(flat.findings.filter((f) => f.level === "warning").map((f) => f.code), ["flat-in-face"]);
  assert.match(flat.findings[0].message, /"label" is flat and lies in a face of "body"/);
  assert.deepEqual(codes(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("label", [5, 2, 14.05], [9, 6, 14.05], "b")), "warning"), []);

  assert.deepEqual(codes(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("line", [5, 8, 5], [5, 8, 9])), "warning"), ["no-size"]);

  const uv = shapeOf(el("body", [2, 0, 2], [14, 8, 14]));
  uv.elements[0].faces.north.uv = [0, 0, 20, 8];
  const found = checkShape(uv).findings;
  assert.deepEqual(found.map((f) => [f.level, f.code]), [["warning", "uv"]]);
  assert.match(found[0].message, /north \[0, 0, 20, 8\] of 16 x 16/);
  // A bigger texture (per key, or for the whole shape) makes the same UV fine.
  assert.deepEqual(codes({ ...uv, textureSizes: { a: [32, 32] } }), []);
  assert.deepEqual(codes({ ...uv, textureWidth: 32 }), []);

  const key = checkShape(shapeOf(el("body", [2, 0, 2], [14, 8, 14], "ghost")));
  assert.deepEqual(key.findings.map((f) => [f.level, f.code]), [["note", "texture"]]);
});

test("check: hidden parts, parts outside the block, worn items and empty shapes", () => {
  assert.deepEqual(codes(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("core", [5, 2, 5], [9, 6, 9]))), ["inside"]);
  const out = checkShape(shapeOf(el("body", [-4, 0, 2], [14, 20, 14])));
  assert.deepEqual(out.findings.map((f) => [f.level, f.code]), [["note", "outside"]]);
  assert.match(out.findings[0].message, /west \(x -4\), up \(y 20\)/);
  assert.deepEqual(out.blocks, [1.13, 1.25, 0.75]);
  // Pieces of a worn item hang on body bones that aren't in the file: nothing can be said about gaps.
  const worn = shapeOf(el("hat", [2, 30, 2], [6, 32, 6], "a", { stepParentName: "Head" }), el("boot", [2, 0, 2], [4, 3, 4], "a", { stepParentName: "FootL" }), el("glove", [20, 10, 2], [22, 12, 4], "a", { stepParentName: "HandL" }));
  assert.deepEqual(codes(worn), ["worn"]);
  const empty = checkShape({ elements: [{ name: "pivot", from: [1, 1, 1], to: [1, 1, 1], faces: {} }] });
  assert.deepEqual([empty.findings.map((f) => f.code), empty.errors, empty.bounds], [["empty"], 1, undefined]);
  assert.deepEqual(checkShape(undefined).findings.map((f) => f.code), ["empty"]);
});

test("formatCheck: bounds, findings worst first, the element table and a verdict line", () => {
  const c = checkShape(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("band", [5, 0, 13], [7, 8, 14], "b"), el("lid", [2, 9, 2], [14, 10, 14], "a", { rotationOrigin: [2, 9, 2], rotationX: -10 })));
  const lines = formatCheck(c, { elements: true });
  assert.equal(lines[0], "bounds: x 2..14, y 0..12.07, z 1.83..14 (0.75 x 0.75 x 0.76 blocks; 16 units = 1 block)");
  assert.match(lines[1], /^error: "lid" touches nothing else/);
  assert.match(lines[2], /^warning: "body" and "band" have faces in the same plane/);
  assert.ok(lines.includes("  lid   2..14  9..12.07  1.83..13.82  turned  [a]"), lines.join("\n"));
  assert.equal(lines.at(-1), "check: 1 error, 1 warning, 1 note");
  assert.ok(!formatCheck(c).some((l) => l.startsWith("elements")));
  assert.equal(formatCheck(checkShape(shapeOf(el("body", [2, 0, 2], [14, 8, 14])))).at(-1), "check: ok");
  // Many findings of one kind are cut short.
  const many = checkShape(shapeOf(el("body", [0, 0, 0], [16, 1, 16]), ...Array.from({ length: 5 }, (_, i) => el(`f${i}`, [i * 3, 5, 5], [i * 3 + 1, 6, 6]))));
  const cut = formatCheck(many, { maxPerCode: 2 });
  assert.equal(cut.filter((l) => l.startsWith("error:")).length, 2);
  assert.ok(cut.includes("... and 3 more floating findings (--json lists all)"));
});

test("parseArgs: the model aids are off unless asked for, and say what they need", () => {
  const p = (...argv: string[]) => parseArgs(argv, "/out") as RenderOptions;
  const plain = p("a.json");
  for (const key of ["check", "strict", "grid", "ortho", "sheet", "colorBy", "highlight", "hide", "compare"] as const) assert.equal(plain[key], undefined, key);
  const all = p("a.json", "--check", "--strict", "--grid", "--ortho", "--sheet", "--color-by", "element", "--highlight", "lid,band*", "--hide", "base,post");
  assert.deepEqual([all.check, all.strict, all.grid, all.ortho, all.sheet, all.colorBy, all.highlight, all.hide], [true, true, true, true, true, "element", ["lid", "band*"], ["base", "post"]]);
  assert.equal(p("new.json", "--compare", "old.json").compare, "old.json");
  assert.deepEqual(p("a.json", "--views", "west,bottom").views, ["west", "bottom"]);
  assert.throws(() => p("a.json", "--strict"), /--strict goes with --check/);
  assert.throws(() => p("a.json", "--color-by", "size"), /--color-by/);
  assert.throws(() => p("a.json", "b.json", "--compare", "old.json"), /--compare/);
  assert.throws(() => p("a.json", "--sheet", "--animation", "walk"), /--sheet/);
  assert.throws(() => p("a.json", "--compare", "old.json", "--animation", "walk"), /--compare/);
  assert.throws(() => p("a.json", "--highlight"), /--highlight/);
});

test("views: west and bottom exist, the old defaults are unchanged, and flat side views lose their tilt", () => {
  assert.deepEqual(DEFAULT_VIEWS, ["default", "south", "east", "top", "back"]);
  assert.deepEqual(SHEET_VIEWS, ["default", "back", "top", "bottom", "south", "east", "north", "west"]);
  for (const view of SHEET_VIEWS) assert.ok(VIEWS[view] && VIEW_NOTES[view], view);
  assert.ok(VIEWS.west[0] < 0 && VIEWS.bottom[1] < 0);
  assert.deepEqual(viewVector("east"), VIEWS.east);
  assert.deepEqual(viewVector("east", true), [1, 0, 0]);
  assert.deepEqual(viewVector("west", true), [-1, 0, 0]);
  assert.deepEqual(viewVector("top", true), VIEWS.top);
  assert.deepEqual(viewVector("default", true), VIEWS.default);
  assert.match(VIEW_NOTES.south, /east \(\+x\) is right/);
});

test("aids: guide boxes, element names and patterns", () => {
  const guides = guideBoxes();
  assert.equal(guides.length, 15); // three axes and the block's twelve edges
  assert.deepEqual(guides.filter((g) => g.texture !== "guide:block").map((g) => g.texture), ["guide:x", "guide:y", "guide:z"]);
  assert.deepEqual(AXIS_LABELS.map((l) => l.text), ["+x east", "+y up", "+z south", "0,0,0", "16,16,16"]);
  assert.notEqual(elementColor(0), elementColor(1));
  assert.match(elementColor(40), /^hsl\(\d+, \d+%, \d+%\)$/);

  const raw = { elements: [{ name: "body", children: [{ name: "band-w" }, { name: "hinge", children: [{ name: "lid" }] }] }, { name: "leg" }] };
  assert.deepEqual(elementPaths(raw), ["body", "body/band-w", "body/hinge", "body/hinge/lid", "leg"]);
  assert.ok(matchesElement("body/hinge/lid", ["lid"]));
  assert.ok(matchesElement("body/hinge/lid", ["hinge"]), "a parent's name covers its children");
  assert.ok(matchesElement("body/band-w", ["band*"]));
  assert.ok(matchesElement("body/hinge/lid", ["body/*/lid"]));
  assert.ok(!matchesElement("leg", ["lid", "band*"]));
  assert.ok(!matchesElement("body/band-w", ["band"]));
  assert.deepEqual(unmatchedPatterns(raw, ["lid", "band*", "wheel", "arm*"]), ["wheel", "arm*"]);
});

test("compareShapes: what was added, removed and moved between two versions", () => {
  const before = shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("lid", [2, 8, 2], [14, 10, 14]), el("knob", [7, 10, 7], [9, 11, 9]));
  const after = shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("lid", [2, 8, 2], [14, 11, 14]), el("lock", [7, 3, 14], [9, 5, 14.5]));
  const c = compareShapes("old.json", before, after);
  assert.deepEqual([c.old, c.added, c.removed, c.unchanged], ["old.json", ["lock"], ["knob"], 1]);
  assert.deepEqual(c.moved, [{ path: "lid", was: { min: [2, 8, 2], max: [14, 10, 14] }, now: { min: [2, 8, 2], max: [14, 11, 14] } }]);
});

/** A two-part model with one floating piece, in its own assets tree. */
function writeModel(dir: string, name: string, lidY: number): string {
  const file = path.join(dir, `assets/testmod/shapes/block/${name}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("lid", [2, lidY, 2], [14, lidY + 2, 14], "b"))));
  return file;
}
const options = (files: string[], out: string, extra: Partial<RenderOptions> = {}): RenderOptions => ({
  out, size: 160, floor: false, noTextures: false, animations: [], frames: 8, showFiller: false, noChisel: false, list: false, json: false, files, views: ["south"], ...extra,
});
const isPng = (file: string) => assert.deepEqual([...readFileSync(file).subarray(1, 4)], [0x50, 0x4e, 0x47], file);
/** Width and height from a PNG's IHDR. */
const pngSize = (file: string) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("render --check needs no browser and writes no image; the command exits 1 on an error, or a warning with --strict", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-check-"));
  const log = console.log;
  const lines: string[] = [];
  try {
    const bad = writeModel(dir, "bad", 9), good = writeModel(dir, "good", 8);
    const flush = path.join(dir, "flush.json");
    writeFileSync(flush, JSON.stringify(shapeOf(el("body", [2, 0, 2], [14, 8, 14]), el("band", [5, 0, 13], [7, 8, 14], "b"))));
    const out = path.join(dir, "out");
    const [result] = await renderFiles(options([bad], out, { check: true }));
    assert.equal(result.kind, "model");
    assert.deepEqual(result.images, []);
    assert.ok(!existsSync(out));
    assert.equal(result.kind === "model" && result.check?.errors, 1);
    // Checks are for models: a schematic is refused rather than silently passed.
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    assert.equal(await main(["render", bad, "--check", "--out", out]), 1);
    assert.ok(lines.some((l) => l.includes('error: "lid" touches nothing else')), lines.join("\n"));
    assert.ok(lines.some((l) => l.includes("check: 1 error, 0 warnings")));
    assert.equal(await main(["render", good, "--check", "--out", out]), 0);
    assert.equal(await main(["render", flush, "--check", "--out", out]), 0);
    assert.equal(await main(["render", flush, "--check", "--strict", "--out", out]), 1);
    lines.length = 0;
    assert.equal(await main(["render", bad, "--check", "--json", "--out", out]), 1);
    const json = JSON.parse(lines.join("\n"));
    assert.equal(json[0].check.findings[0].code, "floating");
    assert.deepEqual(json[0].check.elements.map((e: Json) => e.name), ["body", "lid"]);
    console.log = log;
    // A name --highlight doesn't find is an error that lists the names there are.
    await assert.rejects(renderFiles(options([bad], out, { highlight: ["wheel"] })), (err: Error) => err instanceof RenderError && /wheel/.test(err.message) && /body, lid/.test(err.message));
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renders the aids: --grid, --color-by element, --highlight/--hide, --ortho, the new views, --sheet and --compare", { skip: noBrowser }, async () => {
  execFileSync("node", ["esbuild.mjs"], { cwd: appDir });
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-aids-"));
  try {
    const file = writeModel(dir, "box", 8), old = writeModel(dir, "old", 9);
    const out = path.join(dir, "out");
    const plain = await renderFiles(options([file], out, { views: ["south"] }));
    const plainBytes = readFileSync(plain[0].images[0]);

    const [aided] = await renderFiles(options([file], out, { views: ["west", "bottom"], grid: true, ortho: true, colorBy: "element", highlight: ["lid"], hide: ["body"] }));
    assert.deepEqual(aided.images.map((i) => path.basename(i)), ["box-west.png", "box-bottom.png"]);
    aided.images.forEach(isPng);
    // The aids change the picture; without them the same view is drawn as before.
    const [grid] = await renderFiles(options([file], out, { views: ["south"], grid: true }));
    assert.ok(!readFileSync(grid.images[0]).equals(plainBytes));
    const [again] = await renderFiles(options([file], out, { views: ["south"] }));
    assert.ok(readFileSync(again.images[0]).equals(plainBytes));

    const [sheet] = await renderFiles(options([file], out, { sheet: true, grid: true, check: true, views: undefined }));
    assert.deepEqual(sheet.images.map((i) => path.basename(i)), ["box-sheet.png"]);
    isPng(sheet.images[0]);
    const [w, h] = pngSize(sheet.images[0]);
    assert.deepEqual([w, h], [4 * 120, 30 + 2 * 120]); // eight views, four across, under a title line
    // --views picks the sheet's views.
    const [two] = await renderFiles(options([file], out, { sheet: true, views: ["south", "west"] }));
    assert.deepEqual(pngSize(two.images[0]), [2 * 120, 30 + 120]);
    assert.equal(sheet.kind === "model" && sheet.check?.errors, 0);

    const [compare] = await renderFiles(options([file], out, { compare: old }));
    assert.deepEqual(compare.images.map((i) => path.basename(i)), ["box-compare.png"]);
    isPng(compare.images[0]);
    assert.deepEqual(compare.kind === "model" && compare.compare?.moved.map((m) => m.path), ["lid"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- the builder ---

const textures = { m: "block/metal", g: "block/glass" };
const built = (elements: unknown[], extra: Json = {}) => buildShape({ textures, elements, ...extra } as never, "s");
const boxes = (elements: unknown[]) => (built(elements).shape.elements as Json[]).map((e) => [e.name, e.from, e.to]);

test("shape: a size box is placed on, under or against a named element, centered unless aligned", () => {
  const body = { box: [[2, 0, 4], [14, 8, 12]], tex: "m", name: "body" };
  assert.deepEqual(boxes([body, { size: [4, 2, 4], on: "body", tex: "m", name: "knob" }])[1], ["knob", [6, 8, 6], [10, 10, 10]]);
  assert.deepEqual(boxes([body, { size: [4, 2, 4], under: "body", tex: "m", name: "foot" }])[1], ["foot", [6, -2, 6], [10, 0, 10]]);
  assert.deepEqual(boxes([body, { size: [2, 3, 0.5], against: ["body", "south"], tex: "m", name: "lock" }])[1], ["lock", [7, 2.5, 12], [9, 5.5, 12.5]]);
  assert.deepEqual(boxes([body, { size: [1, 2, 2], against: ["body", "west"], tex: "m", name: "ear" }])[1], ["ear", [1, 3, 7], [2, 5, 9]]);
  // null takes the target's size; grow widens that; sink pushes it in; offset moves it last.
  assert.deepEqual(boxes([body, { size: [null, 1, null], on: "body", grow: 0.5, tex: "m", name: "lid" }])[1], ["lid", [1.5, 8, 3.5], [14.5, 9, 12.5]]);
  assert.deepEqual(boxes([body, { size: [4, 2, 4], on: "body", sink: 0.5, offset: [1, 0, -1], tex: "m", name: "k" }])[1], ["k", [7, 7.5, 5], [11, 9.5, 9]]);
  // align lines sides up, inset keeps it off them.
  assert.deepEqual(boxes([body, { size: [2, 5, 2], under: "body", align: ["west", "north"], inset: 1, tex: "m", name: "leg" }])[1], ["leg", [3, -5, 5], [5, 0, 7]]);
  assert.deepEqual(boxes([body, { size: [2, 5, 2], under: "body", align: "east", tex: "m", name: "leg" }])[1], ["leg", [12, -5, 7], [14, 0, 9]]);
  // Around a point, or standing on one; the block itself is a target at the top level.
  assert.deepEqual(boxes([{ size: [4, 2, 6], center: [8, 5, 8], tex: "m", name: "c" }])[0], ["c", [6, 4, 5], [10, 6, 11]]);
  assert.deepEqual(boxes([{ size: [4, 2, 6], base: [8, 0, 8], tex: "m", name: "b" }])[0], ["b", [6, 0, 5], [10, 2, 11]]);
  assert.deepEqual(boxes([{ size: [null, 1, null], against: ["block", "down"], sink: 1, tex: "m", name: "floor" }])[0], ["floor", [0, 0, 0], [16, 1, 16]]);
  // It is an ordinary box: faces get UVs, and what it makes passes the check.
  const { shape } = built([body, { size: [null, 1, null], on: "body", grow: 0.5, tex: "g", name: "lid" }]);
  assert.equal((shape.elements as Json[])[1].faces.up.texture, "#g");
  assert.equal(checkShape(shape).errors, 0);
});

test("shape: children are placed on their \"parent\", in its coordinates", () => {
  const { shape } = built([{ box: [[2, 0, 4], [14, 8, 12]], tex: "m", name: "body", children: [
    { size: [4, 1, 4], on: "parent", tex: "m", name: "knob" },
    { size: [1, 1, 1], on: "knob", tex: "m", name: "tip" },
  ] }]);
  const [knob, tip] = (shape.elements as Json[])[0].children as Json[];
  assert.deepEqual([knob.from, knob.to], [[4, 8, 2], [8, 9, 6]]);
  assert.deepEqual([tip.from, tip.to], [[5.5, 9, 3.5], [6.5, 10, 4.5]]);
  assert.deepEqual(checkShape(shape).elements.map((e) => [e.path, e.min]), [["body", [2, 0, 4]], ["body/knob", [6, 8, 6]], ["body/tip", [7.5, 9, 7.5]]]);
});

test("shape: placement errors name what is there", () => {
  const body = { box: [[2, 0, 4], [14, 8, 12]], tex: "m", name: "body" };
  const fails = (elements: unknown[], pattern: RegExp) => assert.throws(() => built(elements), (err: Error) => err instanceof SpecError && pattern.test(err.message), String(pattern));
  fails([body, { size: [1, 1, 1], on: "lid", tex: "m" }], /"on" names "lid", which isn't an element written before this one in the same list \(body, block\)/);
  fails([{ size: [1, 1, 1], on: "body", tex: "m" }, body], /isn't an element written before/);
  fails([body, { size: [1, 1, 1], tex: "m" }], /needs one of "on", "under", "against"/);
  fails([body, { size: [1, 1, 1], on: "body", under: "body", tex: "m" }], /it has on and under/);
  fails([body, { size: [1, 1], on: "body", tex: "m" }], /"size" is \[width \(x\), height \(y\), depth \(z\)\]/);
  fails([body, { size: [1, 1, 1], against: ["body", "front"], tex: "m" }], /"against" is \[name, face\]/);
  fails([body, { size: [1, 1, 1], on: "body", align: ["up"], tex: "m" }], /can't align "up"/);
  fails([body, { size: [1, 1, 1], on: "body", align: ["west", "east"], tex: "m" }], /two sides on one axis/);
  fails([{ size: [null, 1, 1], center: [8, 8, 8], tex: "m" }], /a null "size" needs/);
  fails([{ ...body, rot: [0, 30, 0] }, { size: [1, 1, 1], on: "body", tex: "m" }], /"body" is turned.*make this a child of it/);
  fails([body, { band: "body", tex: "m" }], /a "band" needs one of "x", "y" or "z"/);
  fails([body, { band: "body", y: [2, 3], out: 0, tex: "m" }], /"out".*must be above 0/);
  fails([{ taper: [[4, 0, 4], [12, 8, 12]], tex: "m" }], /needs "top"/);
  fails([{ taper: [[4, 0, 4], [12, 8, 12]], top: [2, 2], steps: 1, tex: "m" }], /"steps"/);
  fails([{ corners: { box: [[7, 0, 1], [9, 4, 3]], tex: "m", name: "leg" } }], /centered on x = 8/);
  fails([{ wedge: 1 }], /"corners".*"band", "taper"/);
});

test("shape: a band stands proud of its target (so nothing flickers) and stops at the floor", () => {
  const body = { box: [[2, 0, 4], [14, 8, 12]], tex: "m", name: "body" };
  const { shape } = built([body, { band: "body", x: [4, 5.5], tex: "g" }, { band: "body", y: [6, 7], out: 0.5, tex: "g", name: "rim" }]);
  const [, strap, rim] = shape.elements as Json[];
  assert.deepEqual([strap.name, strap.from, strap.to], ["band", [4, 0, 3.75], [5.5, 8.25, 12.25]]);
  assert.equal(strap.faces.down, undefined);
  assert.deepEqual([rim.from, rim.to], [[1.5, 6, 3.5], [14.5, 7, 12.5]]);
  assert.ok(rim.faces.down);
  assert.deepEqual(checkShape(shape).findings.filter((f) => f.level !== "note"), []);
  // The same strap written flush by hand is what the check warns about.
  const flush = built([body, { box: [[4, 0, 4], [5.5, 8, 12]], tex: "g", name: "strap" }]).shape;
  assert.ok(checkShape(flush).findings.some((f) => f.code === "coplanar"));
});

test("shape: a taper is slabs from the base to the top", () => {
  const got = boxes([{ taper: [[4, 2, 4], [12, 8, 12]], top: [2, 4], steps: 3, tex: "m", name: "roof" }]);
  assert.deepEqual(got, [["roof-1", [4, 2, 4], [12, 4, 12]], ["roof-2", [5.5, 4, 5], [10.5, 6, 11]], ["roof-3", [7, 6, 6], [9, 8, 10]]]);
  assert.equal((built([{ taper: [[4, 0, 4], [12, 8, 12]], top: [1, 1], tex: "m" }]).shape.elements as Json[]).length, 3);
  assert.equal(checkShape(built([{ taper: [[4, 0, 4], [12, 8, 12]], top: [1, 1], steps: 6, tex: "m" }]).shape).errors, 0);
});

test("shape: corners copies to all four corners, named by compass point", () => {
  const got = boxes([{ corners: { box: [[1, 0, 1], [3, 12, 3]], tex: "m", name: "leg" } }]);
  assert.deepEqual(got, [["leg-nw", [1, 0, 1], [3, 12, 3]], ["leg-ne", [13, 0, 1], [15, 12, 3]], ["leg-sw", [1, 0, 13], [3, 12, 15]], ["leg-se", [13, 0, 13], [15, 12, 15]]]);
  // Whichever corner it is written in, and round another point; children are named too.
  const { shape } = built([{ corners: { box: [[10, 0, 9], [11, 4, 10]], tex: "m", name: "post", children: [{ box: [[0, 4, 0], [1, 5, 1]], tex: "m", name: "cap" }] }, about: [8, 6] }]);
  const posts = shape.elements as Json[];
  assert.deepEqual(posts.map((p) => [p.name, p.from]), [["post-se", [10, 0, 9]], ["post-sw", [5, 0, 9]], ["post-ne", [10, 0, 2]], ["post-nw", [5, 0, 2]]]);
  assert.deepEqual(posts.map((p) => p.children[0].name), ["cap-se", "cap-sw", "cap-ne", "cap-nw"]);
  // The usual table: legs hung under the top, lined up with its corner.
  const table = built([{ size: [16, 2, 16], base: [8, 12, 8], tex: "m", name: "top" }, { corners: { size: [2, 12, 2], under: "top", align: ["west", "north"], inset: 1, tex: "g", name: "leg" } }]).shape;
  assert.deepEqual(checkShape(table).elements.map((e) => e.name), ["top", "leg-nw", "leg-ne", "leg-sw", "leg-se"]);
  assert.deepEqual(checkShape(table).findings, []);
});

test("shape: mirror and corners default to the middle of the coordinates they are written in", () => {
  const side = { box: [[3, 0, 0], [5, 1, 1]], tex: "m", name: "sideLeft" };
  // The block's middle at the top level (unchanged), the joint's point inside a joint, the parent's middle inside a box.
  assert.deepEqual(boxes([{ mirror: side }])[1], ["sideRight", [11, 0, 0], [13, 1, 1]]);
  const inJoint = built([{ joint: [8, 4, 8], children: [{ mirror: side }, { corners: { box: [[2, 0, 2], [3, 1, 3]], tex: "m", name: "stud" } }] }]).shape;
  const kids = (inJoint.elements as Json[])[0].children as Json[];
  assert.deepEqual([kids[1].name, kids[1].from, kids[1].to], ["sideRight", [-5, 0, 0], [-3, 1, 1]]);
  assert.deepEqual(kids.slice(2).map((k) => [k.name, k.from]), [["stud-se", [2, 0, 2]], ["stud-sw", [-3, 0, 2]], ["stud-ne", [2, 0, -3]], ["stud-nw", [-3, 0, -3]]]);
  const inBox = built([{ box: [[2, 0, 2], [12, 4, 6]], tex: "m", name: "body", children: [{ mirror: { box: [[1, 4, 1], [2, 5, 2]], tex: "m", name: "pegLeft" } }, { mirror: { box: [[1, 4, 0], [2, 5, 1]], tex: "m", name: "z" }, axis: "z" }] }]).shape;
  const pegs = (inBox.elements as Json[])[0].children as Json[];
  assert.deepEqual([pegs[1].name, pegs[1].from, pegs[1].to], ["pegRight", [8, 4, 1], [9, 5, 2]]);
  assert.deepEqual([pegs[3].from, pegs[3].to], [[1, 4, 3], [2, 5, 4]]);
  // "about" still says otherwise.
  assert.deepEqual(boxes([{ mirror: side, about: 6 }])[1], ["sideRight", [7, 0, 0], [9, 1, 1]]);
});

test("shape: poses write the same model with named elements turned", () => {
  const elements = [
    { box: [[2, 0, 2], [14, 8, 14]], tex: "m", name: "body" },
    { joint: [8, 8, 2], name: "hinge", children: [{ box: [[-6, 0, 0], [6, 2, 12]], tex: "m", name: "lid" }] },
    { box: [[7, 3, 14], [9, 5, 14.5]], tex: "g", name: "lock", rot: [0, 0, 10] },
  ];
  const { shape, poses } = built(elements, { poses: { open: { hinge: [-90, 0, 0] }, askew: { lock: [0, 0, 0], lid: [0, 20, 0] } } });
  assert.deepEqual(Object.keys(poses!), ["open", "askew"]);
  const hinge = (s: Json) => (s.elements as Json[])[1];
  assert.equal(hinge(shape).rotationX, undefined);
  assert.equal(hinge(poses!.open).rotationX, -90);
  // A lid hinged along its north edge opens with a NEGATIVE x turn: it now stands up behind the hinge, above the body.
  const lid = checkShape(poses!.open).elements.find((e) => e.name === "lid")!;
  assert.deepEqual([lid.min, lid.max], [[2, 8, 0], [14, 20, 2]]);
  assert.equal((poses!.askew.elements as Json[])[2].rotationZ, undefined);
  const turned = hinge(poses!.askew).children[0];
  assert.deepEqual([turned.rotationY, turned.rotationOrigin], [20, [0, 1, 6]]);
  assert.equal(built(elements).poses, undefined);
  assert.throws(() => built(elements, { poses: { open: { door: [0, 90, 0] } } }), /pose "open" turns "door", which is not an element \(body, hinge, lid, lock\)/);
  assert.throws(() => built(elements, { poses: { "a b": {} } }), /not a usable file name part/);
});

test("scaled: placed boxes, bands, tapers and corners scale too", () => {
  const [a, b, c, d] = scaled(2, [
    { size: [4, null, 2], on: "body", inset: 1, sink: 0.5, offset: [1, 0, 0] },
    { band: "body", y: [2, 3], out: 0.25 },
    { taper: [[4, 0, 4], [12, 8, 12]], top: [2, 2] },
    { corners: { box: [[1, 0, 1], [3, 4, 3]] }, about: [8, 8] },
  ]) as Json[];
  assert.deepEqual([a.size, a.inset, a.sink, a.offset], [[8, null, 4], 2, 1, [2, 0, 0]]);
  assert.deepEqual([b.y, b.out], [[4, 6], 0.5]);
  assert.deepEqual([c.taper, c.top], [[[8, 0, 8], [24, 16, 24]], [4, 4]]);
  assert.deepEqual([d.corners.box, d.about], [[[2, 0, 2], [6, 8, 6]], [16, 16]]);
});

test("vsdev shape: reports each shape's check, writes poses, and --check / --strict set the exit code", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-shape-check-"));
  const log = console.log;
  const lines: string[] = [];
  try {
    const spec = (name: string, shapes: Json) => {
      const file = path.join(dir, name);
      writeFileSync(file, JSON.stringify({ out: "out", shapes }));
      return file;
    };
    const body = { box: [[2, 0, 2], [14, 8, 14]], tex: "m", name: "body" };
    const good = spec("good.json", { chest: { textures, poses: { open: { hinge: [-60, 0, 0] } }, elements: [body, { joint: [8, 8, 2], name: "hinge", children: [{ box: [[-6, 0, 0], [6, 2, 12]], tex: "m", name: "lid" }] }] } });
    const floating = spec("floating.json", { bad: { textures, elements: [body, { box: [[2, 9, 2], [14, 10, 14]], tex: "m", name: "lid" }] } });
    const flush = spec("flush.json", { flush: { textures, elements: [body, { box: [[4, 0, 2], [5, 8, 14]], tex: "g", name: "strap" }] } });
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    assert.equal(await main(["shape", good, "--check", "--strict"]), 0);
    assert.ok(existsSync(path.join(dir, "out/chest.json")) && existsSync(path.join(dir, "out/chest-open.json")));
    assert.equal(JSON.parse(readFileSync(path.join(dir, "out/chest-open.json"), "utf8")).elements[1].rotationX, -60);
    lines.length = 0;
    // Without --check the finding is printed and the exit code stays 0, as before.
    assert.equal(await main(["shape", floating]), 0);
    assert.ok(lines.some((l) => l.includes('error: "lid" touches nothing else')), lines.join("\n"));
    assert.equal(await main(["shape", floating, "--check"]), 1);
    assert.equal(await main(["shape", flush, "--check"]), 0);
    assert.equal(await main(["shape", flush, "--check", "--strict"]), 1);
    lines.length = 0;
    assert.equal(await main(["shape", flush, "--json", "--dry-run"]), 0);
    const [report] = JSON.parse(lines.join("\n"));
    assert.deepEqual([report.shapes[0].check.errors, report.shapes[0].check.warnings, report.shapes[0].check.findings[0].code], [0, 1, "coplanar"]);
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vsdev find: textures and shapes by words, from this folder's assets and the game's", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-find-"));
  const log = console.log, cwd = process.cwd(), env = { ...process.env };
  const lines: string[] = [];
  try {
    for (const f of ["assets/mymod/textures/block/bronze.png", "assets/mymod/textures/block/wood/oak-planks.png", "assets/mymod/shapes/block/chest/normal.json", "assets/mymod/shapes/item/readme.txt", "game/assets/survival/textures/block/wood/planks/oak1.png", "game/assets/survival/shapes/block/wood/table.json", "game/assets/game/shapes/entity/cube.json"]) {
      mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
      writeFileSync(path.join(dir, f), "");
    }
    const mine = listAssets(dir, ["texture", "shape"]);
    assert.deepEqual(mine.map((a) => [a.kind, a.code]), [["texture", "mymod:block/bronze"], ["shape", "mymod:block/chest/normal"], ["texture", "mymod:block/wood/oak-planks"]]);
    // The base game's folders are all the "game" domain.
    assert.deepEqual(listAssets(path.join(dir, "game"), ["shape"]).map((a) => a.code), ["game:block/wood/table", "game:entity/cube"]);
    assert.deepEqual(listAssets(path.join(dir, "nowhere"), ["shape"]), []);
    const all = [...mine, ...listAssets(path.join(dir, "game"), ["texture", "shape"])];
    assert.deepEqual(matchAssets(all, ["OAK", "planks"]).map((a) => a.code), ["game:block/wood/planks/oak1", "mymod:block/wood/oak-planks"]);
    assert.deepEqual(matchAssets(all, ["block/*/normal"]).map((a) => a.code), ["mymod:block/chest/normal"]);
    assert.deepEqual(matchAssets(all, ["o.k"]), []);

    process.chdir(dir);
    process.env.INIT_CWD = dir;
    delete process.env.VINTAGE_STORY;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    assert.equal(await main(["find", "oak", "--textures", "--json", "--game-dir", path.join(dir, "nogame")]), 0);
    const json = JSON.parse(lines.join("\n"));
    assert.deepEqual([json.total, json.results.map((r: Json) => [r.kind, r.code, r.file])], [1, [["texture", "mymod:block/wood/oak-planks", "assets/mymod/textures/block/wood/oak-planks.png"]]]);
    assert.match(json.notes[0], /nogame is not a game install/);
    lines.length = 0;
    assert.equal(await main(["find", "zzz", "--shapes", "--game-dir", path.join(dir, "nogame")]), 0);
    assert.match(lines[0], /nothing matches zzz/);
    console.log = log;
    assert.equal(await main(["find", "--help"]), 0);
  } finally {
    console.log = log;
    process.chdir(cwd);
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});
