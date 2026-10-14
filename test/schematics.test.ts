import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { globSegmentsMatch, resolveSchematicGlob } from "../src/ingest/models/structures.js";
import { extractSchematics, schematicId } from "../src/ingest/models/schematics.js";
import { schematicAssetPath, writeCompressedSchematics, SCHEMATIC_ASSET_BASE } from "../src/ingest/schematicFiles.js";
import { buildSchematicToStructureIndex } from "../src/ingest/structureContents.js";
import { listSchematicFiles } from "../src/ingest/schematicHeader.js";
import type { NormalizedStructure, SchematicInfo } from "../src/ingest/types.js";

const info = (domain: string, relPath: string): SchematicInfo => ({
  id: schematicId(domain, relPath), domain, sourceMod: "game", relPath, name: relPath.split("/").pop()!, pagePath: `${domain}/${relPath.toLowerCase()}`,
  assetPath: SCHEMATIC_ASSET_BASE + schematicAssetPath(domain, relPath), blockCodes: [], itemCodes: [], fileBytes: 1, usedBy: [],
});

test("glob segments: * is a whole segment, * inside a segment is a wildcard, segment counts must match", () => {
  assert.ok(globSegmentsMatch("ruins/*", "ruins/small-1"));
  assert.ok(globSegmentsMatch("ruins/undergroundruin-small-*", "ruins/undergroundruin-small-12"));
  assert.ok(!globSegmentsMatch("ruins/*", "ruins/deep/small-1"));
  assert.ok(!globSegmentsMatch("ruins/small-1", "ruins/small-10"));
  assert.ok(globSegmentsMatch("a.b/c", "a.b/c"));
  assert.ok(!globSegmentsMatch("a.b/c", "aXb/c")); // "." is literal, not a regex wildcard
});

test("glob resolution is scoped to the structure's own domain and tolerates a .json suffix", () => {
  const list = [info("survival", "ruins/a"), info("survival", "ruins/b"), info("betterruins", "ruins/a")];
  assert.deepEqual(resolveSchematicGlob(list, "survival", "ruins/*.json"), [list[0].id, list[1].id]);
  assert.deepEqual(resolveSchematicGlob(list, "betterruins", "ruins/a"), [list[2].id]);
  assert.deepEqual(resolveSchematicGlob(list, "survival", "nothing/*"), []);
});

test("page paths are unique even where slugify(id) would collide", () => {
  const a = info("survival", "trader/forest/-hut3-agr"), b = info("survival", "trader/forest/hut3-agr");
  assert.notEqual(a.pagePath, b.pagePath);
  assert.equal(info("survival", "Ruins/Big_One").pagePath, "survival/ruins/big_one");
});

test("schematic ids and asset paths follow the shared conventions", () => {
  assert.equal(schematicId("survival", "well/deep-1"), "survival:worldgen/schematics/well/deep-1.json");
  assert.equal(schematicAssetPath("survival", "well/deep-1"), "survival/well/deep-1.json.gz");
  assert.equal(info("survival", "well/deep-1").assetPath, "assets/schematics/world/survival/well/deep-1.json.gz");
});

test("buildSchematicToStructureIndex reads schematicIds, many structures to one schematic", () => {
  const s = (id: string, ids: string[][]): NormalizedStructure =>
    ({ id, schematics: ids.map((schematicIds) => ({ globPath: "x", schematicIds })) }) as unknown as NormalizedStructure;
  const index = buildSchematicToStructureIndex([s("s1", [["a", "b"]]), s("s2", [["b"], ["c"]])]);
  assert.deepEqual([...index.get("b")!].sort(), ["s1", "s2"]);
  assert.deepEqual([...index.get("a")!], ["s1"]);
  assert.equal(index.get("zzz"), undefined);
});

test("extractSchematics reads each file once; compression round-trips byte for byte and is reused on rerun", () => {
  const root = mkdtempSync(join(tmpdir(), "schem-test-"));
  try {
    const dir = join(root, "assets", "survival", "worldgen", "schematics", "ruins");
    mkdirSync(dir, { recursive: true });
    const body = JSON.stringify({ SizeX: 3, SizeY: 4, SizeZ: 5, BlockCodes: { "1": "game:rock-granite", "2": "chest-east" }, ItemCodes: { "9": "game:stackrandomizer-ore" }, Indices: [1, 2, 3], BlockIds: [1, 1, 2] });
    writeFileSync(join(dir, "small-1.json"), body);

    const files = listSchematicFiles("survival", join(root, "assets", "survival"), "game");
    const byDomain = new Map([["survival", files]]);
    const { schematics, duplicateIds } = extractSchematics(byDomain);
    assert.deepEqual(duplicateIds, []);
    assert.equal(schematics.length, 1);
    const sc = schematics[0];
    assert.deepEqual([sc.sizeX, sc.sizeY, sc.sizeZ, sc.blockCodeCount], [3, 4, 5, 2]);
    assert.deepEqual(sc.blockCodes, ["game:rock-granite", "chest-east"]);
    assert.deepEqual(sc.itemCodes, ["game:stackrandomizer-ore"]);
    assert.equal(sc.fileBytes, Buffer.byteLength(body));

    const out = join(root, "out");
    const first = writeCompressedSchematics(schematics, byDomain, out);
    assert.deepEqual([first.written, first.reused], [1, 0]);
    const gz = readFileSync(join(out, "survival", "ruins", "small-1.json.gz"));
    assert.equal(gunzipSync(gz).toString(), body);
    assert.equal(sc.gzBytes, gz.length);
    const second = writeCompressedSchematics(schematics, byDomain, out);
    assert.deepEqual([second.written, second.reused], [0, 1]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a path shipped by two sources is reported once and the first one wins", () => {
  const f = (modid: string) => ({ domain: "survival", relPath: "a/b", fullPath: "/nonexistent", sourceMod: modid });
  // fullPath isn't read for the duplicate (it's skipped before reading), so only the first needs to exist
  const root = mkdtempSync(join(tmpdir(), "schem-dup-"));
  try {
    const p = join(root, "a.json");
    writeFileSync(p, "{}");
    const { schematics, duplicateIds } = extractSchematics(new Map([["survival", [{ ...f("game"), fullPath: p }, f("other")]]]));
    assert.equal(schematics.length, 1);
    assert.equal(schematics[0].sourceMod, "game");
    assert.deepEqual(duplicateIds, [schematicId("survival", "a/b")]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
