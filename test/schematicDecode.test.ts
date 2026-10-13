import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newDecodeStats, recordDecodeFailure } from "../src/ingest/schematicHeader.js";
import { Ascii85, TreeAttributeParser, decodeBlockEntity } from "../site/assets/schematicDecode.js";

// ---- test-only encoders: build TreeAttribute blobs byte by byte, then Ascii85 them ----

function encodeAscii85(bytes: number[]): string {
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

const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return out;
};
const str = (s: string): number[] => {
  const b = [...Buffer.from(s, "utf8")];
  return [...varint(b.length), ...b];
};
const i32 = (n: number): number[] => [...new Uint8Array(new Int32Array([n]).buffer)];
const f64 = (n: number): number[] => [...new Uint8Array(new Float64Array([n]).buffer)];
const f32 = (n: number): number[] => [...new Uint8Array(new Float32Array([n]).buffer)];
const i64 = (n: bigint): number[] => [...new Uint8Array(new BigInt64Array([n]).buffer)];
const tag = (id: number, key: string, payload: number[] = []): number[] => [id, ...str(key), ...payload];

const parse = (bytes: number[]) => new TreeAttributeParser(new Uint8Array(bytes).buffer).parse();

function assertFast(fn: () => void, maxMs = 200): void {
  const t = performance.now();
  fn();
  assert.ok(performance.now() - t < maxMs, "decode took too long");
}

// ---- Ascii85 ----

test("Ascii85 round-trips every tail length", () => {
  for (let len = 0; len <= 9; len++) {
    const bytes = Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff);
    assert.deepEqual([...new Uint8Array(Ascii85.decode(encodeAscii85(bytes)))], bytes, `len ${len}`);
  }
});

test("Ascii85 handles z, whitespace and <~ ~> wrappers", () => {
  assert.deepEqual([...new Uint8Array(Ascii85.decode("z"))], [0, 0, 0, 0]);
  const enc = encodeAscii85([1, 2, 3, 4, 5]);
  assert.deepEqual(
    [...new Uint8Array(Ascii85.decode(`<~ ${enc.slice(0, 3)}\n${enc.slice(3)} ~>`))],
    [1, 2, 3, 4, 5],
  );
});

test("Ascii85 throws on z inside a block and on a lone final char", () => {
  assert.throws(() => Ascii85.decode("!!z"), /'z'/);
  assert.throws(() => Ascii85.decode("!!!!!!"), /more than one character/);
});

// ---- TreeAttribute type codes ----

test("scalar types 1-5, 9", () => {
  const out = parse([
    ...tag(1, "i", i32(-5)),
    ...tag(2, "l", i64(2n ** 40n)),
    ...tag(3, "d", f64(1.5)),
    ...tag(4, "f", f32(0.25)),
    ...tag(5, "s", str("héllo")),
    ...tag(9, "b", [1]),
    ...tag(9, "b0", [0]),
  ]);
  assert.deepEqual(out, { i: -5, l: "1099511627776", d: 1.5, f: 0.25, s: "héllo", b: true, b0: false });
});

test("nested tree (type 6) and terminator stop parsing", () => {
  const out = parse([...tag(6, "n", [...tag(1, "x", i32(1)), 0]), ...tag(1, "y", i32(2)), 0, ...tag(1, "ignored", i32(3))]);
  assert.deepEqual(out, { n: { x: 1 }, y: 2 });
});

const u16 = (n: number): number[] => [n & 0xff, n >> 8];
const f32s = (xs: number[]): number[] => xs.flatMap(f32);
const f64s = (xs: number[]): number[] => xs.flatMap(f64);

// Layouts below are from vsapi's *Attribute.cs FromBytes (the real game format).
test("array types 8, 10-16 with valid lengths", () => {
  const out = parse([
    ...tag(8, "bytes", [...u16(3), 1, 2, 3]),
    ...tag(10, "strs", [...i32(2), ...str("a"), ...str("bc")]),
    ...tag(11, "ints", [...i32(2), ...i32(7), ...i32(-8)]),
    ...tag(12, "floats", [...i32(2), ...f32s([0.5, -2])]),
    ...tag(13, "doubles", [...i32(1), ...f64s([1.25])]),
    ...tag(14, "trees", [...i32(2), ...tag(1, "x", i32(1)), 0, 0]),
    ...tag(15, "longs", [...i32(1), ...i64(9n)]),
    ...tag(16, "bools", [...i32(3), 1, 0, 1]),
  ]);
  assert.deepEqual(out, {
    bytes: [1, 2, 3], strs: ["a", "bc"], ints: [7, -8], floats: [0.5, -2], doubles: [1.25],
    trees: [{ x: 1 }, {}], longs: ["9"], bools: [true, false, true],
  });
});

test("byte array length is a uint16, not a varint", () => {
  const data = Array.from({ length: 200 }, (_, i) => i);
  assert.deepEqual(parse([...tag(8, "b", [...u16(200), ...data]), ...tag(1, "after", i32(5)), 0]), { b: data, after: 5 });
});

test("itemstack (type 7): isNull flag, class/id/size, nested stack attributes", () => {
  const stack = (cls: number, id: number, size: number, attrs: number[]) => [0, ...i32(cls), ...i32(id), ...i32(size), ...attrs, 0];
  const out = parse([
    ...tag(6, "slots", [
      ...tag(7, "0", stack(1, 509, 3, tag(1, "durability", i32(40)))),
      ...tag(7, "1", stack(0, 8190, 1, [])),
      ...tag(7, "2", [1]), // null stack
      0,
    ]),
    ...tag(1, "after", i32(5)),
    0,
  ]);
  assert.deepEqual(out, {
    slots: {
      0: { itemClass: "item", id: 509, stackSize: 3, attributes: { durability: 40 } },
      1: { itemClass: "block", id: 8190, stackSize: 1, attributes: {} },
      2: null,
    },
    after: 5,
  });
});

test("varint lengths above 127 decode", () => {
  const long = "x".repeat(300);
  assert.equal(parse(tag(5, "s", str(long))).s, long);
});

// ---- hostile lengths (regression for the 491s BetterRuins decode, see FINDINGS_SLOW.md) ----

test("huge array counts clamp to the bytes remaining", () => {
  assertFast(() => {
    assert.deepEqual(parse(tag(8, "a", [...u16(65535), 1, 2, 3])), { a: [1, 2, 3] });
    assert.deepEqual(parse(tag(10, "a", [...i32(0x7fffffff), 0, 0, 0])), { a: ["", "", ""] });
    assert.deepEqual(parse(tag(11, "a", [...i32(0x7fffffff), ...i32(5), ...i32(6)])), { a: [5, 6] });
    assert.deepEqual(parse(tag(12, "a", [...i32(0x7fffffff), ...f32s([1])])), { a: [1] });
    assert.deepEqual(parse(tag(13, "a", [...i32(0x7fffffff), ...f64s([1])])), { a: [1] });
    assert.deepEqual(parse(tag(14, "a", [...i32(0x7fffffff), 0, 0])), { a: [{}, {}] });
    assert.deepEqual(parse(tag(15, "a", [...i32(0x7fffffff), ...i64(7n)])), { a: ["7"] });
    assert.deepEqual(parse(tag(16, "a", [...i32(0x7fffffff), 1, 0])), { a: [true, false] });
  });
});

test("negative array counts decode as empty", () => {
  for (const id of [10, 11, 12, 13, 14, 15, 16]) {
    assert.deepEqual(parse([...tag(id, "a", i32(-1)), 0]).a, [], `type ${id}`);
  }
});

test("exactly-fitting array counts are not clamped", () => {
  assert.deepEqual(parse(tag(11, "a", [...i32(2), ...i32(1), ...i32(2)])).a, [1, 2]);
  assert.deepEqual(parse(tag(15, "a", [...i32(2), ...i64(1n), ...i64(2n)])).a, ["1", "2"]);
});

test("nesting beyond the game's depth limit of 30 throws instead of overflowing the stack", () => {
  let bytes: number[] = [0];
  for (let i = 0; i < 40; i++) bytes = [...tag(6, "n", bytes), 0];
  assert.throws(() => parse(bytes), /depth limit/);
});

// ---- failure modes ----

test("an id the game does not register throws (the game would too), rather than misaligning", () => {
  for (const id of [17, 99]) assert.throws(() => parse(tag(id, "x", [1, 2, 3])), /Unknown TreeAttribute type/);
});

test("fixed-size reads throw RangeError on truncated input; strings are flagged instead", () => {
  assert.throws(() => parse([1, ...str("i"), 1, 2]), RangeError);
  assert.equal(parse([5, ...str("s"), ...varint(10), 65, 66]).s, "AB[TRUNCATED]");
});

// ---- real entity shapes ----

test("tapestry / wallcarving / clutter flat blobs decode", () => {
  const tapestry = [...tag(5, "blockCode", str("tapestry-east")), ...tag(5, "type", str("rot1")), 0];
  assert.deepEqual(decodeBlockEntity(encodeAscii85(tapestry)), { blockCode: "tapestry-east", type: "rot1" });

  const clutter = [
    ...tag(5, "blockCode", str("clutter")),
    ...tag(5, "type", str("gravestone-4")),
    ...tag(4, "meshAngle", f32(-4.5)),
    ...tag(9, "collected", [0]),
    0,
  ];
  assert.deepEqual(decodeBlockEntity(encodeAscii85(clutter)), {
    blockCode: "clutter", type: "gravestone-4", meshAngle: -4.5, collected: false,
  });
});

test("committed sample schematic: every block entity decodes, tapestries and clutter carry a type", () => {
  const url = new URL("../site/tools/schematic/samples/default.json", import.meta.url);
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
