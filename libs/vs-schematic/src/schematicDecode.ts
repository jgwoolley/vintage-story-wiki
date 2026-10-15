// Decodes a Vintage Story schematic's `BlockEntities` values: each is an Ascii85-encoded binary
// blob holding one placed block's runtime attributes (a `TreeAttribute`, vsapi's tag-length-value
// attribute-tree format -- see `TreeAttribute.cs`/`Ascii85.cs` in anegostudios/vsapi). Originally
// ported from jgwoolley/vintage-story-schematic-preview's index.html, since rewritten against
// vsapi's real per-type `FromBytes` layouts (the port had several wrong). This file is pure
// ArrayBuffer/DataView/TextDecoder logic, so it runs in Node (the ingest pipeline, the tests), the
// browser (the wiki's schematic viewer, compiled by this package's `tsc` build) and a VS Code
// extension host alike. Do not add any Node-specific (`node:*`, `require`) or DOM-specific API to
// this file -- the root tsconfig (lib ES2022, no DOM) type-checks it as a guard, since the wiki's
// ingest imports it.

/** One decoded attribute-tree node: the `TreeAttribute` root, a nested tree, or an item stack's attributes. */
export type TreeAttributes = Record<string, unknown>;

export const Ascii85 = {
  c_first: 33, // '!'
  c_last: 117, // 'u'
  s_powers: [52200625, 614125, 7225, 85, 1],

  decode(encoded: string): ArrayBuffer {
    // Clean string: remove whitespace and the <~ ~> wrappers if present
    encoded = encoded.replace(/\s/g, "");
    if (encoded.startsWith("<~")) encoded = encoded.substring(2);
    if (encoded.endsWith("~>")) encoded = encoded.substring(0, encoded.length - 2);

    const decodedBytes: number[] = [];
    let count = 0;
    let value = 0;

    for (let i = 0; i < encoded.length; i++) {
      const ch = encoded.charCodeAt(i);

      if (ch === 122) { // 'z'
        if (count !== 0) throw new Error("Character 'z' invalid inside an Ascii85 block.");
        this.pushValue(decodedBytes, 0, 0);
        count = 0;
        value = 0;
      } else if (ch >= this.c_first && ch <= this.c_last) {
        value += (ch - this.c_first) * this.s_powers[count];
        count++;

        if (count === 5) {
          this.pushValue(decodedBytes, value, 0);
          count = 0;
          value = 0;
        }
      }
    }

    if (count > 0) {
      if (count === 1) throw new Error("The final Ascii85 block must contain more than one character.");
      const padding = 5 - count;
      for (let i = count; i < 5; i++) {
        value += 84 * this.s_powers[i];
      }
      this.pushValue(decodedBytes, value, padding);
    }

    return new Uint8Array(decodedBytes).buffer as ArrayBuffer;
  },

  pushValue(arr: number[], value: number, padding: number): void {
    arr.push((value >>> 24) & 0xFF);
    if (padding === 3) return;
    arr.push((value >>> 16) & 0xFF);
    if (padding === 2) return;
    arr.push((value >>> 8) & 0xFF);
    if (padding === 1) return;
    arr.push(value & 0xFF);
  },
};

export class TreeAttributeParser {
  private readonly view: DataView;
  private readonly decoder = new TextDecoder();
  private depth = 0;
  offset = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  private parseNested(): TreeAttributes {
    if (this.depth > 30) throw new Error("TreeAttribute nesting beyond the game's depth limit of 30");
    this.depth++;
    try { return this.parse(); } finally { this.depth--; }
  }

  readString(): string {
    let length = 0, shift = 0;
    while (this.offset < this.view.byteLength) {
      const byte = this.view.getUint8(this.offset++);
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }

    if (length === 0) return "";

    // SAFETY CHECK: Ensure we don't read past the end of the buffer
    const available = this.view.byteLength - this.offset;
    const actualLength = Math.min(length, available);

    const strBytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, actualLength);
    this.offset += actualLength;

    const decoded = this.decoder.decode(strBytes);
    return actualLength < length ? decoded + "[TRUNCATED]" : decoded;
  }

  parse(): TreeAttributes {
    const result: TreeAttributes = {};
    while (this.offset < this.view.byteLength) {
      const attrId = this.view.getUint8(this.offset++);
      if (attrId === 0) break;
      const key = this.readString();
      result[key] = this.readAttribute(attrId);
    }
    return result;
  }

  readInt(): number {
    let result = 0, shift = 0;
    while (this.offset < this.view.byteLength) {
      const byte = this.view.getUint8(this.offset++);
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  }

  // Layout per vsapi's TreeAttribute.cs / *Attribute.cs `FromBytes` (a C# BinaryReader stream: LE
  // fixed-width numbers, 7-bit-varint-prefixed UTF-8 strings). Ids: 1 int, 2 long, 3 double, 4 float,
  // 5 string, 6 tree, 7 itemstack, 8 byte[] (uint16 length), 9 bool, 10 string[], 11 int[], 12 float[],
  // 13 double[], 14 tree[], 15 long[], 16 bool[] (arrays 10-16: int32 count). An id the real game
  // doesn't register throws there (AttributeIdMapping lookup), so it throws here too rather than
  // guessing and misaligning the rest of the blob.
  //
  // Every count is clamped to the bytes left (`maxCount`): a garbage count must not spin through
  // billions of iterations (it once cost ~4s per microblock entity).
  private maxCount(count: number, elementBytes: number): number {
    return Math.max(0, Math.min(count, Math.floor((this.view.byteLength - this.offset) / elementBytes)));
  }

  private readArray<T>(elementBytes: number, readOne: () => T): T[] {
    const declared = this.view.getInt32(this.offset, true);
    this.offset += 4;
    const count = this.maxCount(declared, elementBytes);
    const out = new Array<T>(count);
    for (let i = 0; i < count; i++) out[i] = readOne();
    return out;
  }

  readAttribute(id: number): unknown {
    const v = this.view;
    switch (id) {
      case 1: { const x = v.getInt32(this.offset, true); this.offset += 4; return x; }
      case 2: { const x = v.getBigInt64(this.offset, true); this.offset += 8; return x.toString(); }
      case 3: { const x = v.getFloat64(this.offset, true); this.offset += 8; return x; }
      case 4: { const x = v.getFloat32(this.offset, true); this.offset += 4; return x; }
      case 5: return this.readString();
      case 6: return this.parseNested();
      case 7: { // ItemstackAttribute: bool isNull, then (class, id, stacksize, stack attributes tree)
        if (v.getUint8(this.offset++) !== 0) return null;
        const itemClass = v.getInt32(this.offset, true);
        const itemId = v.getInt32(this.offset + 4, true);
        const stackSize = v.getInt32(this.offset + 8, true);
        this.offset += 12;
        // `id` is the game's runtime collectible id; in a schematic it indexes ItemCodes/BlockCodes.
        return { itemClass: itemClass === 0 ? "block" : "item", id: itemId, stackSize, attributes: this.parseNested() };
      }
      case 8: { // ByteArrayAttribute: uint16 length
        const len = Math.min(v.getUint16(this.offset, true), v.byteLength - this.offset - 2);
        this.offset += 2;
        const arr = new Uint8Array(v.buffer, v.byteOffset + this.offset, len);
        this.offset += len;
        return Array.from(arr);
      }
      case 9: return v.getUint8(this.offset++) !== 0;
      case 10: return this.readArray(1, () => this.readString()); // each string takes >= 1 byte
      case 11: return this.readArray(4, () => { const x = v.getInt32(this.offset, true); this.offset += 4; return x; });
      case 12: return this.readArray(4, () => { const x = v.getFloat32(this.offset, true); this.offset += 4; return x; });
      case 13: return this.readArray(8, () => { const x = v.getFloat64(this.offset, true); this.offset += 8; return x; });
      case 14: return this.readArray(1, () => this.parseNested());
      case 15: return this.readArray(8, () => { const x = v.getBigInt64(this.offset, true); this.offset += 8; return x.toString(); });
      case 16: return this.readArray(1, () => v.getUint8(this.offset++) !== 0);
      default:
        throw new Error(`Unknown TreeAttribute type ${id} at offset ${this.offset}`);
    }
  }
}

/** Convenience: decode one `BlockEntities[packedIndex]` Ascii85 string straight to a plain object. */
export function decodeBlockEntity(asciiString: string): TreeAttributes {
  const buffer = Ascii85.decode(asciiString);
  return new TreeAttributeParser(buffer).parse();
}
