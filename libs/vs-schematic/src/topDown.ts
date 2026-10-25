// A schematic seen from above, like a map: for every (x, z) column the highest block that is drawn. Pure (no DOM, no Three.js) so the
// wiki's schematic page (assets/schematicTopDown.js draws it on a canvas) and tests share it. North is up: z grows southwards, as in the game.

/** What a column needs: a block's position and code (a `Voxel` from schematicVoxels.ts fits). */
export interface TopDownBlock {
  x: number;
  y: number;
  z: number;
  code: string;
}

export interface TopDownView {
  width: number;
  depth: number;
  /** Lowest x / z of the blocks, so cell (cx, cz) is the column at world (minX + cx, minZ + cz). */
  minX: number;
  minZ: number;
  minY: number;
  maxY: number;
  /** Row-major (`cz * width + cx`): the topmost block of each column, undefined where the column is empty. */
  tops: ({ y: number; code: string } | undefined)[];
}

/** The top-down map of `blocks` (callers drop blocks that aren't drawn, e.g. worldgen filler); null when there are none. */
export function topDownView(blocks: Iterable<TopDownBlock>): TopDownView | null {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  const list = [...blocks];
  if (!list.length) return null;
  for (const b of list) {
    minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x);
    minZ = Math.min(minZ, b.z); maxZ = Math.max(maxZ, b.z);
    minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y);
  }
  const width = maxX - minX + 1;
  const depth = maxZ - minZ + 1;
  const tops: TopDownView["tops"] = new Array(width * depth);
  for (const b of list) {
    const i = (b.z - minZ) * width + (b.x - minX);
    const current = tops[i];
    if (!current || b.y > current.y) tops[i] = { y: b.y, code: b.code };
  }
  return { width, depth, minX, minZ, minY, maxY, tops };
}

/**
 * Relief shading for one cell, -1 (in shadow) to 1 (lit), like a hill-shaded map lit from the north-west: higher than the cell to its
 * north-west is lit, lower is shadowed. Cells next to empty ground use their own height, so the edge of a structure isn't shaded.
 */
export function reliefShade(view: TopDownView, cx: number, cz: number): number {
  const here = view.tops[cz * view.width + cx];
  if (!here) return 0;
  const neighbor = (dx: number, dz: number) => {
    const x = cx + dx, z = cz + dz;
    return x >= 0 && z >= 0 ? view.tops[z * view.width + x]?.y ?? here.y : here.y;
  };
  const slope = (here.y - neighbor(-1, 0)) + (here.y - neighbor(0, -1));
  return Math.max(-1, Math.min(1, slope / 3));
}
