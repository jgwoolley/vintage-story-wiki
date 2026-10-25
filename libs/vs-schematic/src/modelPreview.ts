// The 3D preview of an item or creature model (a Vintage Story shape file), on the shared voxel viewer. Untextured: the
// game's textures aren't in the dedicated-server download, so each texture key (e.g. "metal", "skin") gets a stable hash
// color instead. Boxes come from shapeBoxes.ts; the camera frames and orbits the model's own bounding box.
import type { CompactShape, ShapeBox } from "./shapeBoxes.js";
import { shapeToBoxes } from "./shapeBoxes.js";
import { stringToColor } from "./schematicVoxels.js";
import type { ViewerSettings } from "./viewerSettings.js";
import { createVoxelViewer } from "./voxelViewer.js";
import type { VoxelViewer } from "./voxelViewer.js";

/** Mounts a preview into `container` (needs a CSS height). Null without WebGL, or when the shape has nothing to draw. */
export function createModelPreview(container: HTMLElement, shape: CompactShape, label: string, settings?: ViewerSettings): VoxelViewer<ShapeBox> | null {
  const boxes = shapeToBoxes(shape);
  if (!boxes.length) return null;
  const viewer = createVoxelViewer(container, { voxels: boxes, label, cellsCenteredOnIntegers: false, settings });
  viewer?.setStyle((box) => ({ color: stringToColor(box.texture ?? "") }));
  return viewer;
}
