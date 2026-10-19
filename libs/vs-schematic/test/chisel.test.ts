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
