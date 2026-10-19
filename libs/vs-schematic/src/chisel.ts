// Chiseled blocks (class `microblock`, code `chiseledblock`): decode a block entity's cuboids and
// materials, verified against vssurvivalmod/Systems/Microblock/BEMicroBlock.cs (`FromUint`) and
// RESEARCH.md topic 6. Pure data, no DOM, so the wiki, tests and the VS Code extension share it.
import type { TreeAttributes } from "./schematicDecode.js";

/** One box inside the block's 16x16x16 voxel grid; min inclusive, max exclusive (1..16). */
export interface ChiselCuboid {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  /** Index into `ChiselShape.materials` (the packed value's top 8 bits). */
  material: number;
}

export interface ChiselShape {
  cuboids: ChiselCuboid[];
  /** Block code per material index, e.g. `game:rock-granite`; `unknown` when the id isn't in BlockCodes. */
  materials: string[];
  /** The raw block ids of `materials`, as stored in the entity. */
  materialIds: number[];
  /** The cuboids exactly as stored (uint32), for re-export without a lossy round trip. */
  packed: number[];
  /** The block's name (`blockName` on the entity, or the ChiselTools shape file's name), when set. */
  name?: string;
}

/** Voxels (of 4096) each material fills; overlapping cuboids are counted once, last one wins like the game. */
export function materialVolumes(shape: ChiselShape): number[] {
  const grid = new Int16Array(16 * 16 * 16).fill(-1);
  for (const c of shape.cuboids) {
    for (let x = c.x1; x < c.x2; x++) {
      for (let y = c.y1; y < c.y2; y++) {
        for (let z = c.z1; z < c.z2; z++) grid[(y * 16 + z) * 16 + x] = c.material;
      }
    }
  }
  const volumes = new Array<number>(shape.materials.length).fill(0);
  for (const m of grid) if (m >= 0 && m < volumes.length) volumes[m]++;
  return volumes;
}

export function unpackCuboid(value: number): ChiselCuboid {
  const v = value >>> 0;
  return {
    x1: v & 15,
    y1: (v >>> 4) & 15,
    z1: (v >>> 8) & 15,
    x2: ((v >>> 12) & 15) + 1,
    y2: ((v >>> 16) & 15) + 1,
    z2: ((v >>> 20) & 15) + 1,
    material: (v >>> 24) & 0xff,
  };
}

export function packCuboid(c: ChiselCuboid): number {
  return (
    (c.x1 | (c.y1 << 4) | (c.z1 << 8) | ((c.x2 - 1) << 12) | ((c.y2 - 1) << 16) | ((c.z2 - 1) << 20) | (c.material << 24)) >>> 0
  );
}

const numbers = (value: unknown): number[] | null => (Array.isArray(value) ? value.map((n) => Number(n)) : null);

/**
 * The chisel shape of a decoded block entity, or null if it isn't a chiseled block (no `cuboids`
 * and `materials` arrays). `blockCodes` is the schematic's BlockCodes (id -> code).
 */
export function decodeChiseledBlock(attrs: TreeAttributes, blockCodes: Record<string, string>): ChiselShape | null {
  const packed = numbers(attrs.cuboids);
  const materialIds = numbers(attrs.materials);
  if (!packed || !materialIds) return null;
  return {
    cuboids: packed.map(unpackCuboid),
    materials: materialIds.map((id) => blockCodes[String(id)] ?? "unknown"),
    materialIds,
    packed: packed.map((n) => n >>> 0),
    name: typeof attrs.blockName === "string" && attrs.blockName ? attrs.blockName : undefined,
  };
}

/** Material index per voxel of the 16x16x16 grid (`(y*16+z)*16+x`), -1 where empty; later cuboids overwrite earlier ones. */
export function voxelGrid(shape: ChiselShape): Int16Array {
  const grid = new Int16Array(16 * 16 * 16).fill(-1);
  for (const c of shape.cuboids) {
    for (let x = c.x1; x < c.x2; x++) {
      for (let y = c.y1; y < c.y2; y++) {
        for (let z = c.z1; z < c.z2; z++) grid[(y * 16 + z) * 16 + x] = c.material;
      }
    }
  }
  return grid;
}

export interface ShapeMatchOptions {
  /** `same`: the same block in the same voxels; `any`: only the carved shape counts. */
  materials: "same" | "any";
  /** Also treat the four rotations about the vertical axis, and their mirror images, as the same shape. */
  symmetries: boolean;
}

const bareBlock = (code: string): string => code.replace(/^[^:]+:/, "");

/**
 * A string that is equal for two chiseled blocks exactly when they fill the same voxels (with the same
 * materials, unless `any`) -- independent of how the voxels are split into cuboids and of the order of
 * the material list. Null for an empty block.
 */
export function shapeKey(shape: ChiselShape, materials: "same" | "any", transform: (x: number, z: number) => [number, number] = (x, z) => [x, z]): string | null {
  const grid = voxelGrid(shape);
  const used = materials === "any" ? [] : [...new Set(Array.from(grid).filter((m) => m >= 0).map((m) => bareBlock(shape.materials[m] ?? "unknown")))].sort();
  let key = "";
  let run = 0, last = -2, filled = 0;
  for (let y = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const [sx, sz] = transform(x, z);
        const m = grid[(y * 16 + sz) * 16 + sx];
        const value = m < 0 ? -1 : materials === "any" ? 0 : used.indexOf(bareBlock(shape.materials[m] ?? "unknown"));
        if (m >= 0) filled++;
        if (value === last) run++;
        else {
          if (run) key += `${last}:${run},`;
          last = value;
          run = 1;
        }
      }
    }
  }
  key += `${last}:${run}`;
  return filled ? `${used.join("|")}~${key}` : null;
}

// Source voxel (sx, sz) for each target voxel (x, z): a quarter turn about the vertical axis r times, optionally mirrored in x first.
const turn = (x: number, z: number): [number, number] => [15 - z, x];
const SYMMETRIES: { label: string; map: (x: number, z: number) => [number, number] }[] = [0, 1].flatMap((mirror) =>
  [0, 1, 2, 3].map((turns) => ({
    label: `${mirror ? "mirrored" : "as-is"}${turns ? `, turned ${turns * 90}°` : ""}`,
    map: (x: number, z: number): [number, number] => {
      let p: [number, number] = mirror ? [15 - x, z] : [x, z];
      for (let i = 0; i < turns; i++) p = turn(...p);
      return p;
    },
  })),
);

/** key -> how the searched shape has to be turned to produce it (every orientation allowed by `options`). */
export function queryKeys(shape: ChiselShape, options: ShapeMatchOptions): Map<string, string> {
  const keys = new Map<string, string>();
  for (const s of options.symmetries ? SYMMETRIES : SYMMETRIES.slice(0, 1)) {
    const key = shapeKey(shape, options.materials, s.map);
    if (key && !keys.has(key)) keys.set(key, s.label);
  }
  return keys;
}

const toBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** URL query values describing a shape (`shape`: packed cuboids as little-endian uint32, base64url; `mats`: block codes, comma-separated). */
export function shapeToParams(shape: ChiselShape): { shape: string; mats: string } {
  const bytes = new Uint8Array(shape.packed.length * 4);
  const view = new DataView(bytes.buffer);
  shape.packed.forEach((v, i) => view.setUint32(i * 4, v >>> 0, true));
  return { shape: toBase64Url(bytes), mats: shape.materials.join(",") };
}

/** Inverse of `shapeToParams`; throws on a malformed value. */
export function shapeFromParams(shapeParam: string, matsParam: string): ChiselShape {
  const bytes = fromBase64Url(shapeParam);
  if (bytes.length % 4) throw new Error("Malformed shape parameter.");
  const view = new DataView(bytes.buffer);
  const packed = Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true));
  const materials = matsParam ? matsParam.split(",") : [];
  return { cuboids: packed.map(unpackCuboid), materials, materialIds: materials.map((_, i) => i), packed };
}
