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
  };
}
