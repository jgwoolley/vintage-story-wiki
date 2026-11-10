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
  /** Looking at the west face (-x), slightly from above. */
  west: [-1, 0.15, 0],
  /** Straight up from underneath; the tiny z keeps the camera's up vector well defined. */
  bottom: [0, -1, 0.001],
};

/** The views of a --sheet, in order: two three-quarter views, then the six sides drawn flat (no perspective). */
export const SHEET_VIEWS = ["default", "back", "top", "bottom", "south", "east", "north", "west"];

/** The side views (everything but the three-quarter ones), which --ortho and a sheet draw flat and square on. */
export const SIDE_VIEWS = ["south", "east", "north", "west", "top", "bottom"];

/** What a view shows, for a sheet's cell titles: which way is right (and up, for plans). */
export const VIEW_NOTES: Record<string, string> = {
  default: "from the south-east, above",
  back: "from the north-west, above",
  south: "south side: east (+x) is right",
  east: "east side: north (-z) is right",
  north: "north side: west (-x) is right",
  west: "west side: south (+z) is right",
  top: "from above: north (-z) is up, east (+x) right",
  bottom: "from below: south (+z) is up, east (+x) right",
};

/** A view's direction; `flat` takes the slight downward tilt out of the four side views, for a true elevation. */
export function viewVector(view: string, flat = false): Vec3 {
  const v = VIEWS[view];
  return flat && SIDE_VIEWS.includes(view) && v[1] === 0.15 ? [v[0], 0, v[2]] : v;
}

export const DEFAULT_VIEWS = ["default", "south", "east", "top", "back"];
