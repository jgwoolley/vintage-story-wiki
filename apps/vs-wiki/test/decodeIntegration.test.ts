import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newDecodeStats, recordDecodeFailure } from "../src/ingest/schematicHeader.js";
import { decodeBlockEntity } from "vs-schematic/schematicDecode.js";

// Integration checks that need wiki-owned files (the committed viewer sample, ingest's DecodeStats);
// the pure decoder tests live in libs/vs-schematic/test.

test("committed sample schematic: every block entity decodes, tapestries and clutter carry a type", () => {
  const url = new URL("../../../apps/vs-wiki/site/tools/schematic/samples/default.json", import.meta.url);
  const schematic = JSON.parse(readFileSync(url, "utf8")) as { BlockEntities: Record<string, string> };
  const codes: Record<string, number> = {};
  for (const blob of Object.values(schematic.BlockEntities)) {
    const e = decodeBlockEntity(blob);
    assert.equal(typeof e.blockCode, "string");
    if (/^(tapestry|clutter)/.test(e.blockCode as string)) {
      assert.equal(typeof e.type, "string", `${e.blockCode} lacks a type`);
    }
    codes[(e.blockCode as string).split("-")[0]] = (codes[(e.blockCode as string).split("-")[0]] ?? 0) + 1;
  }
  assert.equal(Object.values(schematic.BlockEntities).length, 41);
  assert.equal(codes.tapestry, 4);
  assert.equal(codes.clutter, 4); // clutter x3 + clutter-devastation x1
});

test("recordDecodeFailure counts every failure but keeps only 3 examples", () => {
  const stats = newDecodeStats();
  recordDecodeFailure(undefined, "ignored", new Error("x")); // stats is optional
  for (let i = 0; i < 5; i++) recordDecodeFailure(stats, `s #${i}`, new Error("boom"));
  assert.equal(stats.failures, 5);
  assert.deepEqual(stats.examples, ["s #0: boom", "s #1: boom", "s #2: boom"]);
});
