// Export a chiseled block as a ChiselTools (QPTech, mod id `chiseltools`) pantograph portfolio file.
//
// Format, read from the mod's decompiled `PortfolioSave`/`PortfolioLoad`/`PantographData`
// (chiseltools.dll 1.17.9): an XmlSerializer dump of
//   PantographData { string name; byte[] voxeldata; byte[] matdata; string[] blockcodes; bool materialPasteOK; BlockPos pos }
// where `voxeldata` is protobuf-net `List<uint>` (the packed cuboids) and `matdata` protobuf-net `int[]`
// (block ids; on load the mod replaces them by looking up `blockcodes`, index for index). protobuf-net
// writes a root-level primitive list as repeated field 1, unpacked: `08 <varint>` per element.
import { unpackCuboid } from "./chisel.js";
import type { ChiselShape } from "./chisel.js";

/** Where the game keeps portfolio files: `GetOrCreateDataPath("chiselportfolio")` inside VintagestoryData. */
export const PORTFOLIO_FOLDER = "chiselportfolio";

function varint(value: number): number[] {
  const out: number[] = [];
  let v = BigInt.asUintN(64, BigInt(value));
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

/** protobuf-net serialisation of a root-level `List<uint>` / `int[]`. */
export function protobufIntList(values: number[]): Uint8Array {
  return Uint8Array.from(values.flatMap((n) => [0x08, ...varint(n)]));
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A file name safe to use in `.pf load <name>`: the command takes a single word, and it is a plain file name. */
export function portfolioFileName(name: string): string {
  return name.trim().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "chiseled-block";
}

/** The portfolio file's text (UTF-8, no BOM, like the mod's own StreamWriter output). */
export function chiselToolsPortfolioXml(shape: ChiselShape, name: string): string {
  const codes = shape.materials.map((code) => (code.includes(":") ? code : `game:${code}`));
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<PantographData xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `  <name>${escapeXml(name)}</name>`,
    `  <voxeldata>${base64(protobufIntList(shape.packed))}</voxeldata>`,
    `  <matdata>${base64(protobufIntList(shape.materialIds))}</matdata>`,
    "  <blockcodes>",
    ...codes.map((c) => `    <string>${escapeXml(c)}</string>`),
    "  </blockcodes>",
    "  <materialPasteOK>true</materialPasteOK>",
    "</PantographData>",
    "",
  ].join("\n");
}

function decodeVarintList(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i++] !== 0x08) throw new Error("Unexpected protobuf field in a shape file.");
    let v = 0n, shift = 0n;
    while (i < bytes.length) {
      const b = bytes[i++];
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7n;
    }
    out.push(Number(BigInt.asUintN(32, v)));
  }
  return out;
}

const unescapeXml = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Read a ChiselTools portfolio file (the `PantographData` XML `.pf save` writes) back into a shape. Inverse of `chiselToolsPortfolioXml`. */
export function parsePortfolioXml(xml: string): { name: string; shape: ChiselShape } {
  const tag = (name: string): string => {
    const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
    if (!m) throw new Error(`Not a ChiselTools shape file (no <${name}>).`);
    return m[1];
  };
  const bytes = (name: string) => Uint8Array.from(atob(tag(name).trim()), (c) => c.charCodeAt(0));
  const packed = decodeVarintList(bytes("voxeldata"));
  const materialIds = decodeVarintList(bytes("matdata"));
  const materials = [...tag("blockcodes").matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unescapeXml(m[1]));
  const nameMatch = /<name>([\s\S]*?)<\/name>/.exec(xml);
  return {
    name: nameMatch ? unescapeXml(nameMatch[1]) : "",
    shape: { cuboids: packed.map(unpackCuboid), materials, materialIds, packed, name: nameMatch ? unescapeXml(nameMatch[1]) : undefined },
  };
}

/** Whether a file's text is a ChiselTools shape file (XML) rather than a schematic (JSON). */
export function looksLikePortfolio(text: string): boolean {
  return text.trimStart().startsWith("<") && text.includes("<PantographData");
}
