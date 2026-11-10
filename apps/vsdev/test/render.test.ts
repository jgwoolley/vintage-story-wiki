import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { gzipSync } from "node:zlib";
import { chiselToolsPortfolioXml } from "@nf3t/vs-schematic/chiselExport.js";
import { packCuboid } from "@nf3t/vs-schematic/chisel.js";
import { outputName, parseArgs, sampleFrames, UsageError } from "../src/render/args.js";
import { bodyCandidates, decodeText, loadInput, schematicBoxes } from "../src/render/inputs.js";
import { appDir } from "../src/paths.js";
import { ENVIRONMENT_FILES, pageEnvironment, renderFiles, type RenderedInput } from "../src/render/render.js";
import type { RenderOptions } from "../src/render/args.js";
import { chromium } from "playwright-core";

/** Tests that draw need Playwright's Chromium (`npx playwright-core install chromium`; CI installs it); without it they're skipped. */
const noBrowser = !existsSync(chromium.executablePath()) && "no Playwright Chromium (npx playwright-core install chromium)";

const DEFAULTS = {
  out: "/out", size: 640, floor: false, noTextures: false, animations: [], frames: 8, showFiller: false, noChisel: false, list: false, json: false,
};

test("parseArgs: defaults, options and errors", () => {
  assert.deepEqual(parseArgs(["a.json"], "/out"), { files: ["a.json"], ...DEFAULTS });
  assert.deepEqual(parseArgs(["a.json", "b.json", "--out", "x", "--size", "300", "--views", "south,top", "--floor"], "/out"), {
    ...DEFAULTS, files: ["a.json", "b.json"], out: "x", size: 300, views: ["south", "top"], floor: true,
  });
  assert.deepEqual(parseArgs(["m.json", "--animation", "walk,idle", "--frames", "6", "--columns", "3", "--json"], "/out"), {
    ...DEFAULTS, files: ["m.json"], animations: ["walk", "idle"], frames: 6, columns: 3, json: true,
  });
  assert.equal((parseArgs(["m.json", "--animation", "all"], "/out") as RenderOptions).animations, "all");
  assert.equal((parseArgs(["m.json", "--animation", "walk", "--frame", "7.5"], "/out") as RenderOptions).frame, 7.5);
  assert.deepEqual(parseArgs(["s.json.gz", "--max-y", "4", "--show-filler", "--no-chisel", "--block-colors", "c.json", "--list"], "/out"), {
    ...DEFAULTS, files: ["s.json.gz"], maxY: 4, showFiller: true, noChisel: true, blockColors: "c.json", list: true,
  });
  assert.deepEqual(parseArgs(["a.json", "--grass", "--sky"], "/out"), { ...DEFAULTS, files: ["a.json"], grass: true, sky: true });
  assert.equal(parseArgs(["--help"], "/out"), "help");
  assert.throws(() => parseArgs([], "/out"), UsageError);
  assert.throws(() => parseArgs(["a.json", "--views", "sideways"], "/out"), /unknown view sideways/);
  assert.throws(() => parseArgs(["a.json", "--size", "12"], "/out"), UsageError);
  assert.throws(() => parseArgs(["a.json", "--out"], "/out"), /--out needs a value/);
  assert.throws(() => parseArgs(["a.json", "--bogus"], "/out"), /unknown option/);
  assert.throws(() => parseArgs(["a.json", "--frame", "3"], "/out"), /exactly one --animation/);
  assert.throws(() => parseArgs(["a.json", "--animation", "all", "--frame", "3"], "/out"), /exactly one --animation/);
  assert.throws(() => parseArgs(["a.json", "--frames", "0"], "/out"), UsageError);
});

test("outputName drops the folder and extension, and names animation frames and sheets", () => {
  assert.equal(outputName("assets/x/shapes/item/temporalloom.json", "south"), "temporalloom-south.png");
  assert.equal(outputName("ruin.json.gz", "top"), "ruin-top.png");
  assert.equal(outputName("chair.pf", "east"), "chair-east.png");
  assert.equal(outputName("wolf.json", "default", { code: "walk", part: 7 }), "wolf-default-walk-f007.png");
  assert.equal(outputName("wolf.json", "default", { code: "walk", part: 7.5 }), "wolf-default-walk-f7.5.png");
  assert.equal(outputName("wolf.json", "default", { code: "walk/fast", part: "sheet" }), "wolf-default-walk_fast-sheet.png");
});

test("sampleFrames spreads frames evenly over the animation", () => {
  assert.deepEqual(sampleFrames(40, 4), [0, 10, 20, 30]);
  assert.deepEqual(sampleFrames(10, 3), [0, 3.33, 6.67]);
  assert.deepEqual(sampleFrames(0, 2), [0, 0.5]);
});

/** A schematic packed index: x = i & 0x3FF, z = (i >> 10) & 0x3FF, y = (i >> 20) & 0x3FF. */
const pack = (x: number, y: number, z: number) => x | (z << 10) | (y << 20);

/** A one-attribute TreeAttribute blob (Ascii85) like a chiseled block's entity: `cuboids` and `materials` int arrays. */
function chiselEntity(cuboids: number[], materials: number[]): string {
  const bytes: number[] = [];
  const int32 = (n: number) => bytes.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
  const str = (s: string) => {
    bytes.push(s.length); // 7-bit length prefix, short strings only
    for (const c of s) bytes.push(c.charCodeAt(0));
  };
  for (const [key, values] of [["cuboids", cuboids], ["materials", materials]] as const) {
    bytes.push(11); // IntArrayAttribute (int32 count, then int32s)
    str(key);
    int32(values.length);
    for (const v of values) int32(v);
  }
  bytes.push(0);
  return ascii85(Uint8Array.from(bytes));
}

function ascii85(bytes: Uint8Array): string {
  let out = "<~";
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = [0, 1, 2, 3].map((k) => bytes[i + k] ?? 0);
    let n = ((chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3]) >>> 0;
    const digits: string[] = [];
    for (let k = 0; k < 5; k++) {
      digits.unshift(String.fromCharCode((n % 85) + 33));
      n = Math.floor(n / 85);
    }
    const used = Math.min(4, bytes.length - i) + 1;
    out += used === 5 && digits.every((d) => d === "!") ? "z" : digits.slice(0, used).join("");
  }
  return out + "~>";
}

/** A 2x1x1 schematic: stone at x=0, a chiseled block (one 8x16x16 cuboid of planks) at x=1, and a meta-filler above. */
function sampleSchematic() {
  const half = packCuboid({ x1: 0, y1: 0, z1: 0, x2: 8, y2: 16, z2: 16, material: 0 });
  return {
    Indices: [pack(0, 0, 0), pack(1, 0, 0), pack(0, 1, 0)],
    BlockIds: [1, 2, 3],
    BlockCodes: { "1": "game:rock-granite", "2": "game:chiseledblock", "3": "game:meta-filler", "4": "game:planks-oak" },
    BlockEntities: { [String(pack(1, 0, 0))]: chiselEntity([half], [4]) },
  };
}

test("schematicBoxes cuts chiseled blocks into cuboids and hides filler", () => {
  const input = schematicBoxes(sampleSchematic(), { showFiller: false, chisel: true });
  assert.equal(input.summary.blocks, 3);
  assert.equal(input.summary.drawn, 2);
  assert.equal(input.summary.hiddenFiller, 1);
  assert.equal(input.summary.chiseled, 1);
  assert.deepEqual(input.summary.size, [2, 1, 1]);
  const planks = input.boxes.find((b) => input.codes[b.code] === "game:planks-oak")!;
  assert.deepEqual(planks, { x: 0.75, y: 0, z: 0, sx: 0.5, sy: 1, sz: 1, code: planks.code }, "half a block, on the block's west side");

  const cubes = schematicBoxes(sampleSchematic(), { showFiller: true, chisel: false, maxY: 0 });
  assert.equal(cubes.summary.chiseled, 0);
  assert.equal(cubes.summary.hiddenFiller, 0);
  assert.equal(cubes.summary.drawn, 2, "--max-y 0 leaves out the filler above");
  assert.deepEqual(cubes.codes.sort(), ["game:chiseledblock", "game:rock-granite"]);
});

test("loadInput tells models, schematics (plain and gzipped) and ChiselTools shapes apart", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-render-inputs-"));
  try {
    const opts = { showFiller: false, chisel: true };
    const schematic = JSON.stringify(sampleSchematic());
    writeFileSync(path.join(dir, "s.json"), schematic);
    writeFileSync(path.join(dir, "s.json.gz"), gzipSync(schematic));
    writeFileSync(path.join(dir, "m.json"), JSON.stringify({ elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] }));
    const shape = { cuboids: [], materials: ["game:rock-granite"], materialIds: [1], packed: [packCuboid({ x1: 0, y1: 0, z1: 0, x2: 16, y2: 4, z2: 16, material: 0 })] };
    writeFileSync(path.join(dir, "slab.pf"), chiselToolsPortfolioXml(shape, "slab"));
    writeFileSync(path.join(dir, "other.json"), "{}");
    assert.equal((await loadInput(path.join(dir, "s.json"), opts)).kind, "schematic");
    assert.equal((await loadInput(path.join(dir, "s.json.gz"), opts)).kind, "schematic");
    assert.equal((await loadInput(path.join(dir, "m.json"), opts)).kind, "model");
    const chisel = await loadInput(path.join(dir, "slab.pf"), opts);
    assert.equal(chisel.kind, "chisel");
    if (chisel.kind === "chisel") assert.deepEqual(chisel.volumes, [16 * 4 * 16]);
    await assert.rejects(loadInput(path.join(dir, "other.json"), opts), /isn't a Vintage Story model/);
    assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), "{}", "a BOM is dropped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bodyCandidates looks in the model's domain, then game and survival", () => {
  const found = bodyCandidates("/x/assets/mymod/shapes/item/hat.json", "/game/assets");
  assert.deepEqual(found, [
    "/x/assets/mymod/shapes/entity/humanoid/seraph-faceless.json",
    "/x/assets/game/shapes/entity/humanoid/seraph-faceless.json",
    "/x/assets/survival/shapes/entity/humanoid/seraph-faceless.json",
    "/game/assets/game/shapes/entity/humanoid/seraph-faceless.json",
    "/game/assets/survival/shapes/entity/humanoid/seraph-faceless.json",
  ]);
});

/** Options for a test render: small, one view, nothing extra. */
const testOptions = (files: string[], out: string, extra: Partial<RenderOptions> = {}): RenderOptions => ({ ...DEFAULTS, files, out, size: 160, views: ["south"], ...extra });

const BACKGROUND: [number, number, number] = [0x2b, 0x2d, 0x31];
const isBackground = ([r, g, b]: number[]) => Math.abs(r - BACKGROUND[0]) + Math.abs(g - BACKGROUND[1]) + Math.abs(b - BACKGROUND[2]) < 12;

// Needs the game files (npm run download) and Playwright's Chromium; skipped without them, like the extension's screenshots.
/** The repo's game install: ./vintagestory, or an old ./vs_server checkout. */
const gameDir = path.resolve(appDir, "../..", existsSync(path.resolve(appDir, "../../vintagestory")) ? "vintagestory" : "vs_server");
const sword = path.join(gameDir, "assets/survival/shapes/item/tool/blade/admin.json");
test("renders a vanilla model to PNGs", { skip: noBrowser || (!existsSync(sword) && "no game files (npm run download)") }, async () => {
  execFileSync("node", ["esbuild.mjs"], { cwd: appDir });
  const out = mkdtempSync(path.join(tmpdir(), "vsdev-render-"));
  try {
    const [result] = await renderFiles(testOptions([sword], out, { size: 200, views: ["default", "top"] }));
    assert.equal(result.kind, "model");
    if (result.kind !== "model") return;
    assert.ok(result.summary.boxes > 0);
    assert.ok(result.summary.textures.includes("metal"));
    assert.deepEqual(result.images.map((i) => path.basename(i)), ["admin-default.png", "admin-top.png"]);
    for (const image of result.images) assert.deepEqual([...readFileSync(image).subarray(1, 4)], [0x50, 0x4e, 0x47]); // "PNG"
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

/** A solid-color RGB PNG, built by hand (the test has no image library). */
function solidPng(size: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  const row = Buffer.from([0, ...Array.from({ length: size }, () => [r, g, b]).flat()]); // filter byte 0 + pixels
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

test("draws a model's own texture from its assets tree, and the key's color without textures", { skip: noBrowser }, async () => {
  execFileSync("node", ["esbuild.mjs"], { cwd: appDir });
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-render-tex-"));
  try {
    // A one-cube model in its own mod's assets tree, textured pure red from that mod's textures folder.
    const shapeFile = path.join(dir, "assets/testmod/shapes/item/cube.json");
    mkdirSync(path.dirname(shapeFile), { recursive: true });
    mkdirSync(path.join(dir, "assets/testmod/textures/block"), { recursive: true });
    writeFileSync(path.join(dir, "assets/testmod/textures/block/red.png"), solidPng(16, [255, 0, 0]));
    const all = Object.fromEntries(["north", "east", "south", "west", "up", "down"].map((side) => [side, { texture: "#paint", uv: [0, 0, 16, 16] }]));
    writeFileSync(shapeFile, JSON.stringify({ textures: { paint: "block/red", lost: "block/nowhere" }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: all }] }));

    const out = path.join(dir, "out");
    const [textured] = await renderFiles(testOptions([shapeFile], out)) as Extract<RenderedInput, { kind: "model" }>[];
    assert.deepEqual(textured.summary.textured, ["paint"]);
    assert.deepEqual(textured.summary.missing, [{ key: "lost", ref: "block/nowhere" }]);
    const [r, g, b] = textured.centerPixels[0];
    assert.ok(r > 120 && g < 40 && b < 40, `expected red, got ${r},${g},${b}`);

    const [plain] = await renderFiles(testOptions([shapeFile], out, { noTextures: true })) as Extract<RenderedInput, { kind: "model" }>[];
    assert.deepEqual(plain.summary.textured, []);
    const [pr, pg, pb] = plain.centerPixels[0];
    assert.ok(pg > 40 || pb > 40, `expected the key's hash color, got ${pr},${pg},${pb}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renders animation frames and a contact sheet; --frame holds one pose", { skip: noBrowser }, async () => {
  execFileSync("node", ["esbuild.mjs"], { cwd: appDir });
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-render-anim-"));
  try {
    // A cube that slides two blocks east by frame 10 of 20 and back; the camera stays framed on the rest pose, so it leaves the middle.
    const faces = Object.fromEntries(["north", "east", "south", "west", "up", "down"].map((side) => [side, { texture: "#paint" }]));
    const shapeFile = path.join(dir, "slider.json");
    writeFileSync(shapeFile, JSON.stringify({
      elements: [{ name: "Cube", from: [0, 0, 0], to: [16, 16, 16], faces }],
      animations: [{ code: "slide", quantityframes: 20, onAnimationEnd: "Repeat", keyframes: [
        { frame: 0, elements: { Cube: { offsetX: 0 } } },
        { frame: 10, elements: { Cube: { offsetX: 32 } } },
      ] }],
    }));
    const out = path.join(dir, "out");

    const [listed] = await renderFiles(testOptions([shapeFile], out, { list: true }));
    assert.equal(listed.kind, "model");
    if (listed.kind === "model") assert.deepEqual(listed.summary.animations, [{ code: "slide", name: "slide", frames: 20 }]);
    assert.deepEqual(listed.images, [], "--list renders nothing");

    const [anim] = await renderFiles(testOptions([shapeFile], out, { animations: ["slide"], frames: 2 }));
    assert.deepEqual(anim.images.map((i) => path.basename(i)), ["slider-south-slide-f000.png", "slider-south-slide-f010.png", "slider-south-slide-sheet.png"]);
    assert.ok(!isBackground(anim.centerPixels[0]), "frame 0: the cube is in the middle");
    assert.ok(isBackground(anim.centerPixels[1]), `frame 10: the cube has slid away, got ${anim.centerPixels[1]}`);
    const sheet = readFileSync(anim.images[2]);
    assert.equal(sheet.readUInt32BE(16), 2 * 160, "two cells wide"); // PNG IHDR width
    assert.equal(sheet.readUInt32BE(20), 160 + 28, "one row plus the title strip");

    const [held] = await renderFiles(testOptions([shapeFile], out, { animations: ["slide"], frame: 10 }));
    assert.deepEqual(held.images.map((i) => path.basename(i)), ["slider-south-slide-f010.png"]);
    assert.ok(isBackground(held.centerPixels[0]));

    await assert.rejects(renderFiles(testOptions([shapeFile], out, { animations: ["fly"] })), /no animation fly; it has slide/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pageEnvironment reads the game's grass and sky images when there are any, and is off unless asked for", async () => {
  assert.equal(await pageEnvironment({}, undefined), undefined);
  assert.deepEqual(await pageEnvironment({ sky: true }, undefined), { grass: false, sky: true, images: {} });
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-env-"));
  try {
    const sky = path.join(dir, ENVIRONMENT_FILES.sky);
    mkdirSync(path.dirname(sky), { recursive: true });
    writeFileSync(sky, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const env = await pageEnvironment({ grass: true }, dir.split(path.sep).join("/"));
    assert.deepEqual(Object.keys(env!.images), ["sky"]);
    assert.match(env!.images.sky, /^data:image\/png;base64,/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renders a schematic in its block colors and a ChiselTools shape", { skip: noBrowser }, async () => {
  execFileSync("node", ["esbuild.mjs"], { cwd: appDir });
  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-render-schem-"));
  try {
    // BlockColorMod writes BGR hex: "#0000FF" is red.
    const colors = path.join(dir, "colors.json");
    writeFileSync(colors, JSON.stringify({ "game:rock-granite": { hex: "#0000FF", alpha: 0 }, "game:planks-oak": { hex: "#00FF00", alpha: 0 } }));
    const schematicFile = path.join(dir, "ruin.json.gz");
    writeFileSync(schematicFile, gzipSync(JSON.stringify({ Indices: [pack(0, 0, 0)], BlockIds: [1], BlockCodes: { "1": "game:rock-granite" } })));
    const shape = { cuboids: [], materials: ["game:planks-oak"], materialIds: [1], packed: [packCuboid({ x1: 0, y1: 0, z1: 0, x2: 16, y2: 16, z2: 16, material: 0 })] };
    const pfFile = path.join(dir, "cube.pf");
    writeFileSync(pfFile, chiselToolsPortfolioXml(shape, "cube"));
    const out = path.join(dir, "out");

    const [schematic, chisel] = await renderFiles(testOptions([schematicFile, pfFile], out, { blockColors: colors }));
    assert.equal(schematic.kind, "schematic");
    assert.deepEqual(schematic.images.map((i) => path.basename(i)), ["ruin-south.png"]);
    const [r, g, b] = schematic.centerPixels[0];
    assert.ok(r > 120 && g < 60 && b < 60, `expected red granite, got ${r},${g},${b}`);
    assert.equal(chisel.kind, "chisel");
    const [cr, cg, cb] = chisel.centerPixels[0];
    assert.ok(cg > 120 && cr < 60 && cb < 60, `expected green planks, got ${cr},${cg},${cb}`);

    // Outdoors (the game's grass and sky if a client is found, else built-in ones): the block is still drawn in its color.
    const [outdoors] = await renderFiles(testOptions([schematicFile], out, { blockColors: colors, grass: true, sky: true, noTextures: true }));
    const [or, og, ob] = outdoors.centerPixels[0];
    assert.ok(or > 120 && og < 60 && ob < 60, `expected red granite outdoors, got ${or},${og},${ob}`);

    const [defaults] = await renderFiles({ ...testOptions([schematicFile], out, { blockColors: colors }), views: undefined });
    assert.deepEqual(defaults.images.map((i) => path.basename(i)), ["ruin-default.png", "ruin-top.png", "ruin-south.png", "ruin-east.png"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Needs the game files (npm run download); skipped without them.
const ruin = path.join(gameDir, "assets/survival/worldgen/schematics/buriedtreasure/jailor.json");
const wolf = path.join(gameDir, "assets/survival/shapes/entity/animal/mammal/wolf/eurasian-adult.json");
test("renders a vanilla schematic and an animated creature", { skip: noBrowser || (!(existsSync(ruin) && existsSync(wolf)) && "no game files (npm run download)") }, async () => {
  execFileSync("node", ["esbuild.mjs"], { cwd: appDir });
  const out = mkdtempSync(path.join(tmpdir(), "vsdev-render-vanilla-"));
  try {
    const [schematic] = await renderFiles(testOptions([ruin], out, { views: ["default"] }));
    assert.equal(schematic.kind, "schematic");
    if (schematic.kind === "schematic") assert.ok(schematic.summary.drawn > 0);
    const [listed] = await renderFiles(testOptions([wolf], out, { list: true }));
    assert.equal(listed.kind, "model");
    if (listed.kind !== "model") return;
    const code = listed.summary.animations[0]?.code;
    assert.ok(code, "the wolf has animations");
    const [anim] = await renderFiles(testOptions([wolf], out, { animations: [code], frames: 2 }));
    assert.equal(anim.images.length, 3);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
