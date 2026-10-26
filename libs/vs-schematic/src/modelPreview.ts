// The 3D preview of an item or creature model (a Vintage Story shape file), on the shared voxel viewer. Untextured: the
// game's textures aren't in the dedicated-server download, so each texture key (e.g. "metal", "skin") gets a stable hash
// color instead. Boxes come from shapeBoxes.ts; the camera frames and orbits the model's own rest-pose bounding box, and the
// shape's animations (idle, walk...) play by re-posing those boxes every frame without moving the camera.
import type { CompactShape, ShapeBox } from "./shapeBoxes.js";
import { ANIMATION_FPS, samplePose, shapeToBoxes } from "./shapeBoxes.js";
import { stringToColor } from "./schematicVoxels.js";
import type { ViewerSettings } from "./viewerSettings.js";
import { createVoxelViewer } from "./voxelViewer.js";
import type { VoxelViewer } from "./voxelViewer.js";

export interface ModelPreview extends VoxelViewer<ShapeBox> {
  /** The shape's animations, to offer in a picker (empty for a static model). */
  animations: { code: string; name: string }[];
  /** Plays an animation by code in a loop (even one the game holds at its end), or goes back to the rest pose with null. */
  playAnimation(code: string | null): void;
}

/** Mounts a preview into `container` (needs a CSS height). Null without WebGL, or when the shape has nothing to draw. */
export function createModelPreview(container: HTMLElement, shape: CompactShape, label: string, settings?: ViewerSettings): ModelPreview | null {
  const boxes = shapeToBoxes(shape);
  if (!boxes.length) return null;
  const viewer = createVoxelViewer(container, { voxels: boxes, label, cellsCenteredOnIntegers: false, settings });
  if (!viewer) return null;
  viewer.setStyle((box) => ({ color: stringToColor(box.texture ?? "") }));

  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const animations = shape.animations ?? [];
  return {
    ...viewer,
    // A model's grid cell is one block: 16 of its units.
    setFloor: (visible) => viewer.setFloor(visible, 16),
    animations: animations.map((a) => ({ code: a.code, name: a.name ?? a.code })),
    playAnimation(code) {
      stop();
      const animation = animations.find((a) => a.code === code);
      if (!animation) return viewer.setVoxels(boxes);
      const start = performance.now();
      const tick = (now: number) => {
        // The game holds some animations at their last pose; for a preview every one loops, so there is always something to watch.
        const frame = (((now - start) / 1000) * ANIMATION_FPS) % Math.max(1, animation.frames);
        viewer.setVoxels(shapeToBoxes(shape, samplePose({ ...animation, loop: true }, frame)));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    dispose() {
      stop();
      viewer.dispose();
    },
  };
}
