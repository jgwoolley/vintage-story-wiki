import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { decodePiece, parseProtobuf, readPieces, renderOverview, tileOf, TILE_SIZE } from "../site/assets/worldMap.js";

const require = createRequire(import.meta.url);

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 128) {
    out.push((n % 128) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}

/** A tile blob as the game writes it: every pixel an ABGR varint under field 1, then a version and a timestamp. */
function tileBlob(abgr: (i: number) => number): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) bytes.push(0x08, ...varint(abgr(i)));
  bytes.push(0x10, ...varint(3), 0x18, ...varint(1700000000));
  return Uint8Array.from(bytes);
}
const abgr = (r: number, g: number, b: number, a = 255) => ((a * 256 + b) * 256 + g) * 256 + r;
const position = (tileX: number, tileZ: number) => tileZ * 2 ** 27 + tileX;

test("positions pack tileZ above 27 bits of tileX", () => {
  assert.deepEqual(tileOf(position(5, 3)), { tileX: 5, tileZ: 3 });
  assert.deepEqual(tileOf(position(16000, 16000)), { tileX: 16000, tileZ: 16000 });
});

test("parseProtobuf reads varints (including values above 2^31) and length-delimited fields, and rejects truncated input", () => {
  const fields = parseProtobuf(Uint8Array.from([0x08, ...varint(0xff112233), 0x12, 2, 7, 8]));
  assert.deepEqual(fields[0], { id: 1, number: 0xff112233 });
  assert.deepEqual([...fields[1].bytes!], [7, 8]);
  assert.throws(() => parseProtobuf(Uint8Array.from([0x12, 5, 1])), /truncated/);
});

test("decodePiece turns the game's ABGR pixels into RGBA and keeps version and time", () => {
  const piece = decodePiece(position(2, 4), tileBlob((i) => (i === 0 ? abgr(10, 20, 30) : abgr(200, 100, 50, 128))))!;
  assert.equal(piece.tileX, 2);
  assert.equal(piece.tileZ, 4);
  assert.deepEqual([...piece.rgba.slice(0, 4)], [10, 20, 30, 255]);
  assert.deepEqual([...piece.rgba.slice(4, 8)], [200, 100, 50, 128]);
  assert.equal(piece.version, 3);
  assert.equal(piece.lastModified, 1700000000);
  assert.equal(decodePiece(position(0, 0), Uint8Array.from([0x08, 1])), null, "an incomplete tile is skipped");
  assert.equal(decodePiece(position(0, 0), null as unknown as Uint8Array), null);
});

test("renderOverview places tiles by position and averages when it has to downsample", () => {
  const red = decodePiece(position(10, 20), tileBlob(() => abgr(255, 0, 0)))!;
  const blue = decodePiece(position(11, 20), tileBlob(() => abgr(0, 0, 255)))!;
  const full = renderOverview([red, blue], 4096)!;
  assert.equal(full.width, 2 * TILE_SIZE);
  assert.equal(full.height, TILE_SIZE);
  assert.equal(full.blocksPerPixel, 1);
  assert.deepEqual([full.x, full.z], [10 * TILE_SIZE, 20 * TILE_SIZE]);
  assert.deepEqual([...full.rgba.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...full.rgba.slice((TILE_SIZE + 3) * 4, (TILE_SIZE + 3) * 4 + 4)], [0, 0, 255, 255]);
  const small = renderOverview([red, blue], 16)!; // 64 px wide -> every 4th pixel
  assert.equal(small.blocksPerPixel, 4);
  assert.equal(small.width, 16);
  assert.equal(renderOverview([], 16), null);
});

test("readPieces reads a real SQLite mappiece table (sql.js) and skips bad rows", async () => {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE mappiece (position integer PRIMARY KEY, data BLOB)");
  const insert = db.prepare("INSERT INTO mappiece VALUES (?, ?)");
  insert.run([position(3, 4), tileBlob(() => abgr(1, 2, 3))]);
  insert.run([position(4, 4), Uint8Array.from([0x08])]); // not a complete tile
  insert.free();
  const pieces = readPieces(db);
  assert.equal(pieces.length, 1);
  assert.deepEqual([pieces[0].tileX, pieces[0].tileZ], [3, 4]);
  db.close();
});
