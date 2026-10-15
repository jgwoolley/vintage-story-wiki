// Pure helpers shared by the full schematic viewer (the wiki's assets/schematicViewer.js) and the read-only
// preview on each schematic page (assets/schematicPreview.js): turning a Vintage Story schematic into voxels, which
// blocks start hidden, and fetching a gzip-compressed schematic. No DOM, no Three.js -- importable
// from Node tests (fetchGzipText only needs the global fetch/DecompressionStream every runtime here has).
//
// Schematic axes: each Indices entry packs a position as x = i & 0x3FF, z = (i >> 10) & 0x3FF,
// y = (i >> 20) & 0x3FF (y is up); BlockIds[n] indexes BlockCodes for the block at Indices[n].

/**
 * Blocks the viewers start hidden: `meta-filler` is a worldgen marker (it tells the generator what to
 * fill a cell with), not something that exists in the finished structure, and it often makes up much
 * of a schematic's bulk. The domain prefix ("game:") is optional because some schematics omit it.
 * The full viewer lets you turn it back on; the schematic-page preview has no options at all.
 */
/** The fields of a Vintage Story schematic file the voxel conversion needs (the file has more). */
export interface SchematicJson {
  /** Packed block positions: x = i & 0x3FF, z = (i >> 10) & 0x3FF, y = (i >> 20) & 0x3FF. */
  Indices: number[];
  /** `BlockIds[n]` is the key into `BlockCodes` for the block at `Indices[n]`. */
  BlockIds: number[];
  BlockCodes: Record<string, string>;
  /** Packed position (as a string key) -> Ascii85 `TreeAttribute` blob; see schematicDecode.ts. */
  BlockEntities?: Record<string, string>;
}

/** One placed block as an integer grid cell (y up), with its packed index and block code. */
export interface Voxel {
  x: number;
  y: number;
  z: number;
  packed: number;
  code: string;
}

const HIDDEN_BY_DEFAULT = /^(?:[a-z0-9_.-]+:)?meta-filler$/i;

export function isHiddenByDefault(code: string): boolean {
  return HIDDEN_BY_DEFAULT.test(code);
}

export function stringToColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 60%, 55%)`;
}

/** Throws unless `schematic` has the three fields the voxel conversion needs. */
export function assertSchematic(schematic: unknown): asserts schematic is SchematicJson {
  const s = schematic as Partial<SchematicJson> | null | undefined;
  if (!Array.isArray(s?.Indices) || !Array.isArray(s?.BlockIds) || !s?.BlockCodes) {
    throw new Error("Not a Vintage Story schematic (missing Indices / BlockIds / BlockCodes).");
  }
}

export function toVoxels(schematic: Pick<SchematicJson, "Indices" | "BlockIds" | "BlockCodes">): Voxel[] {
  return schematic.Indices.map((packed, i) => {
    const code = schematic.BlockCodes[schematic.BlockIds[i]] || "unknown";
    return { x: packed & 0x3ff, z: (packed >> 10) & 0x3ff, y: (packed >> 20) & 0x3ff, packed, code };
  });
}

/** Fetches a `.json.gz` and returns its decompressed text, using the browser's built-in DecompressionStream. */
export async function fetchGzipText(url: string, onLength?: (length: number) => void): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("this browser has no DecompressionStream, so it can't unpack the compressed schematic; try a current Chrome, Edge, Firefox or Safari");
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  onLength?.(Number(response.headers.get("content-length")));
  return new Response(response.body!.pipeThrough(new DecompressionStream("gzip"))).text();
}
