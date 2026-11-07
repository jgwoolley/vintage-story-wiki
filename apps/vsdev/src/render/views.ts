// The camera angles the renderer takes, shared by the CLI (Node) and the page (browser), so it has no imports.
// A direction is the camera's offset from the model's center in the shape's own axes (y up, +z south, +x east),
// the same space createVoxelViewer's `viewDirection` uses.

export type Vec3 = [number, number, number];

export const VIEWS: Record<string, Vec3> = {
  /** The viewer's own default three-quarter view (what the wiki and the VS Code extension open on). */
  default: [1, 1.1, 1.4],
  /** Looking at the south face (+z), slightly from above. */
  south: [0, 0.15, 1],
  /** Looking at the east face (+x), slightly from above. */
  east: [1, 0.15, 0],
  /** Looking at the north face (-z), slightly from above. */
  north: [0, 0.15, -1],
  /** Straight down; the tiny z keeps the camera's up vector well defined. */
  top: [0, 1, 0.001],
  /** Three-quarter view from the opposite (north-west) corner. */
  back: [-1, 1.1, -1.4],
};

export const DEFAULT_VIEWS = ["default", "south", "east", "top", "back"];
