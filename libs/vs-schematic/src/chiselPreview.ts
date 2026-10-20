// The small 3D preview of a chiseled block's shape, shared by the wiki (the schematic viewer's block panel
// and the schematic search page) and the VS Code extension. A chiseled block is boxes on a 16x16x16 grid,
// drawn with voxelViewer's sized boxes (positions are box centers, sizes in 1/16ths). The camera frames and
// orbits the carved shape's own bounding box, not the 16x16x16 block it sits in, so a small piece off to
// one side still rotates about itself.
import type { ChiselShape } from "./chisel.js";
import type { ViewerSettings } from "./viewerSettings.js";
import { createVoxelViewer } from "./voxelViewer.js";
import type { ViewerVoxel, VoxelViewer } from "./voxelViewer.js";

interface ChiselBox extends ViewerVoxel {
  material: number;
}

/** Mounts a preview into `container` (needs a CSS height); `colorOf(blockCode)` picks each material's color. Null without WebGL. */
export function createChiselPreview(container: HTMLElement, shape: ChiselShape, colorOf: (code: string) => string, settings?: ViewerSettings): VoxelViewer<ChiselBox> | null {
  const boxes: ChiselBox[] = shape.cuboids.map((c) => ({
    x: (c.x1 + c.x2) / 2, y: (c.y1 + c.y2) / 2, z: (c.z1 + c.z2) / 2,
    sx: c.x2 - c.x1, sy: c.y2 - c.y1, sz: c.z2 - c.z1, material: c.material,
  }));
  const viewer = createVoxelViewer(container, { voxels: boxes, label: "3D view of the chiseled block's shape", cellsCenteredOnIntegers: false, settings }); // box edges, not centers, sit on integers
  viewer?.setStyle((box) => ({ color: colorOf(shape.materials[box.material]) }));
  return viewer;
}
