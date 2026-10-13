// Decodes a Vintage Story schematic's `BlockEntities` values: each is an Ascii85-encoded binary
// blob holding one placed block's runtime attributes (a `TreeAttribute`, vsapi's tag-length-value
// attribute-tree format -- see `TreeAttribute.cs`/`Ascii85.cs` in anegostudios/vsapi). Ported
// verbatim from jgwoolley/vintage-story-schematic-preview's index.html, minus its THREE.js/DOM
// rendering -- this file is pure ArrayBuffer/DataView/TextDecoder logic, so it runs unmodified in
// both Node (the ingest pipeline, via a plain relative import) and the browser (a future
// interactive schematic viewer, via <script type="module" src="...">). Do not add any
// Node-specific (`node:*`, `require`) or DOM-specific API to this file -- that's the whole point
// of keeping it here instead of under src/ingest/.

export const Ascii85 = {
  c_first: 33, // '!'
  c_last: 117, // 'u'
  s_powers: [52200625, 614125, 7225, 85, 1],

  decode(encoded) {
    // Clean string: remove whitespace and the <~ ~> wrappers if present
    encoded = encoded.replace(/\s/g, "");
    if (encoded.startsWith("<~")) encoded = encoded.substring(2);
    if (encoded.endsWith("~>")) encoded = encoded.substring(0, encoded.length - 2);

    let decodedBytes = [];
    let count = 0;
    let value = 0;

    for (let i = 0; i < encoded.length; i++) {
      let ch = encoded.charCodeAt(i);

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
      let padding = 5 - count;
      for (let i = count; i < 5; i++) {
        value += 84 * this.s_powers[i];
      }
      this.pushValue(decodedBytes, value, padding);
    }

    return new Uint8Array(decodedBytes).buffer;
  },

  pushValue(arr, value, padding) {
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
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.offset = 0;
    this.decoder = new TextDecoder();
  }

  readString() {
    let length = 0, shift = 0;
    while (this.offset < this.view.byteLength) {
      let byte = this.view.getUint8(this.offset++);
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }

    if (length === 0) return "";

    // SAFETY CHECK: Ensure we don't read past the end of the buffer
    const available = this.view.byteLength - this.offset;
    const actualLength = Math.min(length, available);

    const strBytes = new Uint8Array(this.view.buffer, this.offset, actualLength);
    this.offset += actualLength;

    const decoded = this.decoder.decode(strBytes);
    return actualLength < length ? decoded + "[TRUNCATED]" : decoded;
  }

  parse() {
    const result = {};
    while (this.offset < this.view.byteLength) {
      const attrId = this.view.getUint8(this.offset++);
      if (attrId === 0) break;
      const key = this.readString();
      result[key] = this.readAttribute(attrId);
    }
    return result;
  }

  readInt() {
    let result = 0, shift = 0;
    while (this.offset < this.view.byteLength) {
      let byte = this.view.getUint8(this.offset++);
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  }

  readAttribute(id) {
    switch (id) {
      case 1: { const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
      case 2: { const v = this.view.getBigInt64(this.offset, true); this.offset += 8; return v.toString(); }
      case 3: { const v = this.view.getFloat64(this.offset, true); this.offset += 8; return v; }
      case 4: { const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }
      case 5: return this.readString();
      case 6: return this.parse(); // Nested TreeAttribute
      case 7: { const v = this.view.getFloat64(this.offset, true); this.offset += 8; return v; }
      case 8: { // Byte Array - Usually uses Varint length
        const len = this.readInt();
        const arr = new Uint8Array(this.view.buffer, this.offset, Math.min(len, this.view.byteLength - this.offset));
        this.offset += arr.length;
        return Array.from(arr);
      }
      case 9: return this.view.getUint8(this.offset++) !== 0;
      case 10: { // String Array - Usually uses Varint length
        // Clamp to the bytes left (each string takes >= 1): a misaligned/garbage length must not
        // spin through billions of iterations (it once cost ~4s per microblock entity).
        const len = Math.min(this.readInt() >>> 0, this.view.byteLength - this.offset);
        return Array.from({ length: len }, () => this.readString());
      }
      case 11: { // Int Array - OFTEN USES FIXED INT32 LENGTH
        const len = this.view.getInt32(this.offset, true);
        this.offset += 4;
        const arr = [];
        // Stop as soon as the buffer is exhausted -- a garbage `len` used to keep looping to ~2^31.
        for (let i = 0; i < len && this.offset + 4 <= this.view.byteLength; i++) {
          arr.push(this.view.getInt32(this.offset, true));
          this.offset += 4;
        }
        return arr;
      }
      case 12: { // Long Array
        const len = Math.max(0, Math.min(this.view.getInt32(this.offset, true), (this.view.byteLength - this.offset - 4) >> 3)); this.offset += 4;
        return Array.from({ length: len }, () => {
          const v = this.view.getBigInt64(this.offset, true);
          this.offset += 8;
          return v.toString();
        });
      }
      default:
        return `[Type ${id} unknown]`;
    }
  }
}

/** Convenience: decode one `BlockEntities[packedIndex]` Ascii85 string straight to a plain object. */
export function decodeBlockEntity(asciiString) {
  const buffer = Ascii85.decode(asciiString);
  return new TreeAttributeParser(buffer).parse();
}
