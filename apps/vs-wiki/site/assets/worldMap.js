// The game's client-side world map cache (`Maps/<savegame id>.db`, a SQLite file) as an image. Pure logic, no DOM: site/map's script
// (worldMapPage.js) reads the file with sql.js and draws the result. Ported from the vintage-story-launcher's VintageStoryMap.java.
//
// Table `mappiece(position INTEGER, data BLOB)`: one row per 32x32-pixel tile, one pixel per block. `position` is
// `(tileZ << 27) | tileX`. `data` is a protobuf message: field 1 = each pixel as an ABGR uint32 varint (1024 of them, row by row),
// field 2 = a version, field 3 = last-modified.
export const TILE_SIZE = 32;
const X_BITS = 27;
const X_RANGE = 2 ** X_BITS;

/** Every field of a protobuf message as `{ id, number }` (varint) or `{ id, bytes }` (length-delimited); fixed-width fields are skipped. Throws on a malformed message. */
export function parseProtobuf(data) {
  const fields = [];
  let pos = 0;
  // Varints are accumulated with multiplication, not shifts, so values above 2^31 (an opaque ABGR pixel) stay positive.
  const varint = () => {
    let result = 0;
    let scale = 1;
    for (;;) {
      if (pos >= data.length || scale > 2 ** 63) throw new Error("bad varint");
      const b = data[pos++];
      result += (b & 0x7f) * scale;
      if (b < 0x80) return result;
      scale *= 128;
    }
  };
  while (pos < data.length) {
    const key = varint();
    const id = Math.floor(key / 8);
    switch (key % 8) {
      case 0: fields.push({ id, number: varint() }); break;
      case 1: pos += 8; break;
      case 2: {
        const length = varint();
        if (pos + length > data.length) throw new Error(`truncated field ${id}`);
        fields.push({ id, bytes: data.subarray(pos, pos + length) });
        pos += length;
        break;
      }
      case 5: pos += 4; break;
      default: throw new Error(`unsupported wire type in field ${id}`);
    }
  }
  return fields;
}

/** `{ tileX, tileZ }` of a stored tile position. */
export function tileOf(position) {
  return { tileX: position % X_RANGE, tileZ: Math.floor(position / X_RANGE) };
}

/** One tile: `rgba` is TILE_SIZE*TILE_SIZE*4 bytes (row by row). Null when the blob isn't a complete tile. */
export function decodePiece(position, data) {
  if (!data) return null;
  let fields;
  try {
    fields = parseProtobuf(data);
  } catch {
    return null;
  }
  const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  let count = 0;
  let version = 0;
  let lastModified = 0;
  for (const f of fields) {
    if (f.id === 1 && f.bytes === undefined && count < TILE_SIZE * TILE_SIZE) {
      const abgr = f.number;
      rgba.set([abgr & 0xff, Math.floor(abgr / 256) & 0xff, Math.floor(abgr / 65536) & 0xff, Math.floor(abgr / 16777216) & 0xff], count * 4);
      count++;
    } else if (f.id === 2 && f.bytes === undefined) version = f.number;
    else if (f.id === 3 && f.bytes === undefined) lastModified = f.number;
  }
  return count === TILE_SIZE * TILE_SIZE ? { ...tileOf(position), rgba, version, lastModified } : null;
}

/** The decoded tiles of an opened sql.js `Database`; unreadable tiles are skipped. */
export function readPieces(db) {
  const pieces = [];
  const stmt = db.prepare("SELECT position, data FROM mappiece");
  try {
    while (stmt.step()) {
      const [position, data] = stmt.get();
      const piece = decodePiece(Number(position), data);
      if (piece) pieces.push(piece);
    }
  } finally {
    stmt.free();
  }
  return pieces;
}

/**
 * Draws the explored area as one image, sampling every n-th pixel so the longest side is at most `maxSize` (each output pixel is the
 * average of the samples that fall in it). Returns null when there are no tiles. `x`/`z` are the world block coordinates of the
 * image's top-left corner and `blocksPerPixel` how many blocks one image pixel spans, so a caller can place it on a map.
 */
export function renderOverview(pieces, maxSize = 4096) {
  if (!pieces.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pieces) {
    minX = Math.min(minX, p.tileX); maxX = Math.max(maxX, p.tileX);
    minZ = Math.min(minZ, p.tileZ); maxZ = Math.max(maxZ, p.tileZ);
  }
  const fullWidth = (maxX - minX + 1) * TILE_SIZE;
  const fullHeight = (maxZ - minZ + 1) * TILE_SIZE;
  const step = Math.max(1, Math.ceil(Math.max(fullWidth, fullHeight) / maxSize));
  const width = Math.ceil(fullWidth / step);
  const height = Math.ceil(fullHeight / step);
  const sums = new Uint32Array(width * height * 4);
  const counts = new Uint16Array(width * height);
  for (const p of pieces) {
    const left = (p.tileX - minX) * TILE_SIZE;
    const top = (p.tileZ - minZ) * TILE_SIZE;
    // Samples sit on a global grid so neighbouring tiles line up.
    for (let y = (step - (top % step)) % step; y < TILE_SIZE; y += step) {
      for (let x = (step - (left % step)) % step; x < TILE_SIZE; x += step) {
        const out = Math.floor((top + y) / step) * width + Math.floor((left + x) / step);
        const src = (y * TILE_SIZE + x) * 4;
        for (let c = 0; c < 4; c++) sums[out * 4 + c] += p.rgba[src + c];
        counts[out]++;
      }
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i];
    if (n) for (let c = 0; c < 4; c++) rgba[i * 4 + c] = Math.round(sums[i * 4 + c] / n);
  }
  return { width, height, rgba, blocksPerPixel: step, x: minX * TILE_SIZE, z: minZ * TILE_SIZE, tiles: pieces.length };
}
