import { test } from "node:test";
import assert from "node:assert/strict";
import { codeMatcher, hasMatch, matchingRandomizers, mayContain, scanSchematic } from "../src/schematicSearch.js";
import { packCuboid } from "../src/chisel.js";

// Hand-built TreeAttribute blobs (layouts as in schematicDecode.ts), Ascii85-encoded.
function ascii85(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = bytes.slice(i, i + 4);
    const n = chunk.length;
    while (chunk.length < 4) chunk.push(0);
    let v = ((chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3]) >>> 0;
    let group = "";
    for (let d = 0; d < 5; d++) {
      group = String.fromCharCode(33 + (v % 85)) + group;
      v = Math.floor(v / 85);
    }
    out += group.slice(0, n + 1);
  }
  return out;
}
const str = (s: string): number[] => [s.length, ...[...s].map((c) => c.charCodeAt(0))]; // short ASCII only
const i32 = (n: number): number[] => [...new Uint8Array(new Int32Array([n]).buffer)];
const f64 = (n: number): number[] => [...new Uint8Array(new Float64Array([n]).buffer)];
const tag = (id: number, key: string, payload: number[] = []): number[] => [id, ...str(key), ...payload];
const tree = (...entries: number[][]): number[] => [...entries.flat(), 0];
const stack = (key: string, itemClass: number, id: number, size: number, totalChance?: number): number[] =>
  tag(7, key, [0, ...i32(itemClass), ...i32(id), ...i32(size), ...tree(...(totalChance === undefined ? [] : [tag(3, "totalChance", f64(totalChance))]))]);
const intArray = (key: string, values: number[]): number[] => tag(11, key, [...i32(values.length), ...values.flatMap(i32)]);

test("codeMatcher ignores the domain, is case-insensitive and treats * and {..} as wildcards", () => {
  assert.ok(codeMatcher("game:chest-*")("chest-east"));
  assert.ok(codeMatcher("chest-east")("game:CHEST-east"));
  assert.ok(codeMatcher("plank-{wood}")("plank-oak"));
  assert.ok(!codeMatcher("chest")("chest-east"));
  assert.ok(codeMatcher("a.b")("a.b") && !codeMatcher("a.b")("axb"));
});

test("matchingRandomizers sums the matching members' pool share and respects kind", () => {
  const pools = { "game:stackrandomizer-gear": [
    { domain: "game", code: "gear-rusty", kind: "item" as const, chance: 0.25 },
    { domain: "game", code: "gear-temporal", kind: "item" as const, chance: 0.5 },
  ] };
  assert.equal(matchingRandomizers({ code: "gear-*", kind: "item" }, pools).get("stackrandomizer-gear"), 0.75);
  assert.equal(matchingRandomizers({ code: "gear-rusty", kind: "block" }, pools).size, 0);
});

test("mayContain prefilters on block and item code lists, including randomizers that can produce the target", () => {
  const target = { code: "gear-rusty", kind: "item" as const };
  const r = new Map([["stackrandomizer-gear", 0.5]]);
  assert.ok(mayContain(["game:chest-east"], ["game:gear-rusty"], target, new Map()));
  assert.ok(mayContain([], ["game:stackrandomizer-gear"], target, r));
  assert.ok(!mayContain(["game:chest-east"], ["game:firewood"], target, r));
});

test("scanSchematic counts placed blocks and chiseled materials, and finds stacks and randomizers in containers", () => {
  const pack = (x: number, y: number, z: number) => x | (z << 10) | (y << 20);
  const chisel = tree(
    intArray("cuboids", [packCuboid({ x1: 0, y1: 0, z1: 0, x2: 16, y2: 16, z2: 16, material: 0 }) | 0]),
    intArray("materials", [2]),
  );
  const schematic = {
    Indices: [pack(0, 0, 0), pack(1, 0, 0), pack(2, 0, 0)],
    BlockIds: [2, 1, 2],
    BlockCodes: { "1": "game:chest-east", "2": "game:rock-granite" },
    ItemCodes: { "0": "game:gear-rusty", "1": "game:stackrandomizer-gear" },
    BlockEntities: {
      [pack(1, 0, 0)]: ascii85(tree(tag(6, "inventory", tree(stack("0", 1, 0, 3), stack("1", 1, 1, 1, 0.5))))),
      [pack(0, 0, 0)]: ascii85(chisel),
    },
  };
  const granite = scanSchematic(schematic, { code: "rock-granite", kind: "block" }, new Map());
  assert.equal(granite.placed, 2);
  assert.equal(granite.chiseled, 1);
  const gear = scanSchematic(schematic, { code: "gear-rusty", kind: "item" }, new Map([["stackrandomizer-gear", 0.5]]));
  assert.equal(gear.containers.length, 1);
  assert.deepEqual([gear.containers[0].block, gear.containers[0].count, gear.containers[0].x], ["game:chest-east", 3, 1]);
  assert.equal(gear.possible[0].randomizer, "stackrandomizer-gear");
  assert.deepEqual(gear.possible[0].totalChances, [0.5]);
  assert.ok(hasMatch(gear));
  assert.ok(!hasMatch(scanSchematic(schematic, { code: "firewood", kind: "item" }, new Map())));
});
