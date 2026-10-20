import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeChiseledBlock, materialVolumes, packCuboid, unpackCuboid } from "../src/chisel.js";
import { chiselToolsPortfolioXml, portfolioFileName, protobufIntList } from "../src/chiselExport.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex").toUpperCase();

test("unpackCuboid follows BlockEntityMicroBlock.FromUint (max is stored minus one, material in the top byte)", () => {
  const c = { x1: 1, y1: 2, z1: 3, x2: 16, y2: 5, z2: 4, material: 200 };
  const packed = packCuboid(c);
  assert.ok(packed > 0x7fffffff, "material >= 128 sets the sign bit");
  assert.deepEqual(unpackCuboid(packed), c);
  assert.deepEqual(unpackCuboid(packed | 0), c, "signed int32 as the attribute decoder returns it");
});

test("decodeChiseledBlock resolves material ids through BlockCodes and rejects other entities", () => {
  const full = packCuboid({ x1: 0, y1: 0, z1: 0, x2: 16, y2: 16, z2: 8, material: 0 });
  const half = packCuboid({ x1: 0, y1: 0, z1: 8, x2: 8, y2: 16, z2: 16, material: 1 });
  const shape = decodeChiseledBlock({ cuboids: [full | 0, half], materials: [7, 99] }, { "7": "game:rock-granite" })!;
  assert.deepEqual(shape.materials, ["game:rock-granite", "unknown"]);
  assert.deepEqual(shape.packed, [full, half]);
  assert.deepEqual(materialVolumes(shape), [16 * 16 * 8, 8 * 16 * 8]);
  assert.equal(decodeChiseledBlock({ inventory: {} }, {}), null);
});

test("protobufIntList matches protobuf-net's output for List<uint> / int[] (captured from the game's SerializerUtil)", () => {
  assert.equal(hex(protobufIntList([1, 300, 0xffffffff])), "080108AC0208FFFFFFFF0F");
  assert.equal(hex(protobufIntList([5, 300])), "080508AC02");
});

test("chiselToolsPortfolioXml writes the PantographData layout the mod's XmlSerializer reads", () => {
  const xml = chiselToolsPortfolioXml({ cuboids: [], materials: ["rock-granite", "game:a&b"], materialIds: [5, 300], packed: [1] }, "my <shape>");
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
  assert.match(xml, /<name>my &lt;shape&gt;<\/name>/);
  assert.match(xml, /<voxeldata>CAE=<\/voxeldata>/);
  assert.match(xml, /<matdata>CAUIrAI=<\/matdata>/);
  assert.match(xml, /<string>game:rock-granite<\/string>\s*<string>game:a&amp;b<\/string>/);
  assert.match(xml, /<materialPasteOK>true<\/materialPasteOK>/);
});

test("portfolioFileName gives a single safe word", () => {
  assert.equal(portfolioFileName("  Arch / Window #2 "), "Arch-Window-2");
  assert.equal(portfolioFileName("///"), "chiseled-block");
});

import { readFileSync } from "node:fs";
import { queryKeys, shapeFromParams, shapeKey, shapeToParams } from "../src/chisel.js";
import { parsePortfolioXml } from "../src/chiselExport.js";
import { mayContainShape, scanSchematicForShape } from "../src/schematicSearch.js";

const box = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, material = 0) => packCuboid({ x1, y1, z1, x2, y2, z2, material });
const shapeOf = (packed: number[], materials: string[]) => ({ cuboids: packed.map(unpackCuboid), materials, materialIds: materials.map((_, i) => i), packed });

test("parsePortfolioXml reads a real ChiselTools export (Wayshrine Pillar Bottom, saved by the game)", () => {
  const { name, shape } = parsePortfolioXml(readFileSync(new URL("./fixtures/wayshrine-pillar-bottom.pf", import.meta.url), "utf8"));
  assert.equal(name, "Wayshrine Pillar Bottom");
  assert.deepEqual(shape.materials, ["game:polishedrockold-full-granite", "game:polishedrockold-cobbled-basalt"]);
  assert.equal(shape.cuboids.length, 43);
  assert.ok(shape.cuboids.every((c) => c.material < 2 && c.x2 <= 16 && c.y2 <= 16 && c.z2 <= 16));
  // the exporter reproduces the same data
  assert.deepEqual(parsePortfolioXml(chiselToolsPortfolioXml(shape, name)).shape.packed, shape.packed);
});

test("shapeKey ignores how voxels are split into cuboids and the material order", () => {
  const a = shapeOf([box(0, 0, 0, 16, 8, 16, 0), box(0, 8, 0, 8, 16, 16, 1)], ["game:a", "game:b"]);
  const b = shapeOf([box(8, 8, 0, 16, 16, 16, 0), box(0, 0, 0, 16, 4, 16, 1), box(0, 4, 0, 16, 8, 16, 1)].slice(0, 0).concat([box(0, 8, 0, 8, 16, 8, 0), box(0, 8, 8, 8, 16, 16, 0), box(0, 0, 0, 16, 8, 16, 1)]), ["game:b", "game:a"]);
  assert.equal(shapeKey(a, "same"), shapeKey(b, "same"));
  assert.notEqual(shapeKey(a, "same"), shapeKey(shapeOf([box(0, 0, 0, 16, 8, 16, 0), box(0, 8, 0, 8, 16, 16, 1)], ["game:a", "game:c"]), "same"));
  assert.equal(shapeKey(a, "any"), shapeKey(shapeOf([box(0, 0, 0, 16, 8, 16), box(0, 8, 0, 8, 16, 16)], ["game:z"]), "any"));
  assert.equal(shapeKey(shapeOf([], []), "same"), null);
});

test("queryKeys finds turned and mirrored copies only when asked", () => {
  const pillar = shapeOf([box(0, 0, 0, 4, 16, 4)], ["game:rock-granite"]); // a corner post
  const turned = shapeOf([box(12, 0, 0, 16, 16, 4)], ["game:rock-granite"]);
  const wanted = (opts: { symmetries: boolean }) => queryKeys(pillar, { materials: "same", ...opts });
  assert.ok(wanted({ symmetries: true }).has(shapeKey(turned, "same")!));
  assert.ok(!wanted({ symmetries: false }).has(shapeKey(turned, "same")!));
  assert.equal(wanted({ symmetries: true }).size, 4, "a corner post has 4 distinct orientations (mirrors coincide)");
});

test("shape URL params round-trip", () => {
  const shape = shapeOf([box(1, 2, 3, 16, 5, 4, 200)], ["game:a"]);
  const p = shapeToParams(shape);
  assert.match(p.shape, /^[\w-]+$/);
  assert.deepEqual(shapeFromParams(p.shape, p.mats).packed, shape.packed);
});

test("the shape search prefilters on codes and finds the block in a schematic", () => {
  const pillar = shapeOf([box(0, 0, 0, 4, 16, 4)], ["game:rock-granite"]);
  const query = { shape: pillar, options: { materials: "same" as const, symmetries: true } };
  assert.ok(mayContainShape(["game:chiseledblock", "game:rock-granite"], query));
  assert.ok(!mayContainShape(["game:chiseledblock", "game:rock-basalt"], query));
  assert.ok(mayContainShape(["game:chiseledblock", "game:rock-basalt"], { ...query, options: { ...query.options, materials: "any" } }));
  assert.ok(!mayContainShape(["game:rock-granite"], query));
});

import { looksLikePortfolio } from "../src/chiselExport.js";

test("looksLikePortfolio tells a shape file from a schematic", () => {
  assert.ok(looksLikePortfolio(readFileSync(new URL("./fixtures/wayshrine-pillar-bottom.pf", import.meta.url), "utf8")));
  assert.ok(!looksLikePortfolio('{"Indices":[]}'));
});

import { nameMatcher } from "../src/schematicSearch.js";

test("nameMatcher is a case-insensitive substring, or a glob with *", () => {
  assert.ok(nameMatcher("granite")("Aged granite bricks"));
  assert.ok(nameMatcher("signature")("Syranne Signature Block"));
  assert.ok(nameMatcher("aged*bricks")("Aged granite bricks"));
  assert.ok(!nameMatcher("aged*bricks")("Aged granite"));
  assert.ok(nameMatcher("(Cracked)")("Wet dirty gravel  (Cracked)"), "regex characters are literal");
});

import { inventoryOf } from "../src/blockEntityInfo.js";

test("inventoryOf lists the item stacks of a decoded entity through the schematic's code tables", () => {
  const attrs = {
    blockCode: "game:chest-east",
    inventory: { slots: { "0": { itemClass: "item", id: 7, stackSize: 3 }, "1": { itemClass: "block", id: 2, stackSize: 1, attributes: { totalChance: 0.5 } }, "2": { itemClass: "item", id: 99, stackSize: 1 } } },
  };
  assert.deepEqual(inventoryOf(attrs, { "2": "game:rock-granite" }, { "7": "game:firewood" }).map((e) => [e.path, e.code, e.kind, e.stackSize]), [
    ["inventory.slots.0", "game:firewood", "item", 3],
    ["inventory.slots.1", "game:rock-granite", "block", 1],
    ["inventory.slots.2", null, "item", 1],
  ]);
});
