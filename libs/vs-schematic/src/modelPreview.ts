// The 3D preview of an item or creature model (a Vintage Story shape file), on the shared voxel viewer. Untextured by default:
// the game's textures aren't in the dedicated-server download, so each texture key (e.g. "metal", "skin") gets a stable hash
// color instead. A caller that has the images (a local game install: the model renderer, the VS Code extension) passes them as
// `textures` with a shape compacted with faces, and the faces are drawn textured. Boxes come from shapeBoxes.ts; the camera frames
// and orbits the model's own rest-pose bounding box, and the shape's animations (idle, walk...) play by re-posing those boxes every
// frame without moving the camera.
import type { CompactShape, ShapeBox } from "./shapeBoxes.js";
import { ANIMATION_FPS, samplePose, shapeToBoxes } from "./shapeBoxes.js";
import { stringToColor } from "./schematicVoxels.js";
import type { ViewerSettings } from "./viewerSettings.js";
import { createVoxelViewer } from "./voxelViewer.js";
import type { TextureImage, VoxelViewer } from "./voxelViewer.js";

export interface ModelPreviewOptions {
  /** The camera's offset from the model's center (y up); omitted, the viewer's default three-quarter view. */
  viewDirection?: [number, number, number];
  /** Texture key -> image. Needs a shape from `compactShape(raw, { faces: true })`; keys not given stay colored. */
  textures?: Record<string, TextureImage>;
  /** Give every box its element's `name` and `path` (see `shapeToBoxes`), for a style that colors or hides by element. */
  names?: boolean;
  /** Boxes drawn with the model in every pose and counted in its framing (reference guides: axes, a block outline). */
  extraBoxes?: ShapeBox[];
  /** The camera's field of view in degrees (default 35); a small one is as good as an orthographic view. */
  fov?: number;
}

export interface ModelPreview extends VoxelViewer<ShapeBox> {
  /** The shape's animations, to offer in a picker (empty for a static model); `frames` is the length in frames (ANIMATION_FPS per second). */
  animations: { code: string; name: string; frames: number }[];
  /** Plays an animation by code in a loop (even one the game holds at its end), or goes back to the rest pose with null. */
  playAnimation(code: string | null): void;
  /**
   * Stops any playing animation and holds one pose: `frame` (any real number, wrapped as a loop) of the animation `code`, or the rest pose
   * with null or an unknown code. Deterministic, for still renders of an animation.
   */
  showFrame(code: string | null, frame: number): void;
}

/** Mounts a preview into `container` (needs a CSS height). Null without WebGL, or when the shape has nothing to draw. */
export function createModelPreview(
  container: HTMLElement,
  shape: CompactShape,
  label: string,
  settings?: ViewerSettings,
  { viewDirection, textures, names, extraBoxes = [], fov }: ModelPreviewOptions = {},
): ModelPreview | null {
  const posed = (pose?: Parameters<typeof shapeToBoxes>[1]) => [...shapeToBoxes(shape, pose, { names }), ...extraBoxes];
  const boxes = posed();
  if (boxes.length === extraBoxes.length) return null;
  const viewer = createVoxelViewer(container, { voxels: boxes, label, viewDirection, cellsCenteredOnIntegers: false, settings, textures, fov });
  if (!viewer) return null;
  viewer.setStyle((box) => ({ color: stringToColor(box.texture ?? "") }));

  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const animations = shape.animations ?? [];
  const pose = (code: string | null, frame: number) => {
    const animation = animations.find((a) => a.code === code);
    // The game holds some animations at their last pose; for a preview every one loops, so there is always something to watch.
    viewer.setVoxels(animation ? posed(samplePose({ ...animation, loop: true }, frame)) : boxes);
  };
  return {
    ...viewer,
    // A model's grid cell is one block: 16 of its units.
    setFloor: (visible) => viewer.setFloor(visible, 16),
    setEnvironment: (environment) => viewer.setEnvironment(environment, 16),
    animations: animations.map((a) => ({ code: a.code, name: a.name ?? a.code, frames: a.frames })),
    playAnimation(code) {
      stop();
      const animation = animations.find((a) => a.code === code);
      if (!animation) return pose(null, 0);
      const start = performance.now();
      const tick = (now: number) => {
        pose(animation.code, (((now - start) / 1000) * ANIMATION_FPS) % Math.max(1, animation.frames));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    showFrame(code, frame) {
      stop();
      pose(code, frame);
    },
    dispose() {
      stop();
      viewer.dispose();
    },
  };
}
