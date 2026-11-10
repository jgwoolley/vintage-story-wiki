// What the Node half (render.ts) passes to the page's window functions (page/main.ts) and gets back. No DOM types, so both the root
// tsconfig (Node) and the page's DOM tsconfig can import it.
import type { ChiselShape } from "@nf3t/vs-schematic/chisel.js";
import type { Vec3 } from "./views.js";

export interface PageOptions {
  /** Draw the one-block floor grid. */
  floor: boolean;
  /** Shown top left, and the canvas's accessible name. */
  title: string;
  /** Draw it outdoors: grass to the horizon (replacing the floor grid) and/or a sky (libs/vs-schematic environment.ts). */
  environment?: PageEnvironment;
}

/** The outdoor backdrop and the game images to draw it with (keys of ENVIRONMENT_FILES, as PNG data: URLs; missing ones are built in). */
export interface PageEnvironment {
  grass: boolean;
  sky: boolean;
  images: Record<string, string>;
}

export interface ModelOptions extends PageOptions {
  /** Texture key -> PNG data: URL; empty draws untextured. */
  textures: Record<string, string>;
  /** The player body shape, for a worn item's stepParentName pieces. */
  body?: unknown;
  /** Drawing aids for someone making the model (--grid, --ortho, --color-by, --highlight, --hide). */
  aids?: ModelAids;
}

export interface ModelAids {
  /** The axes from the origin with their names, the outline of the block (0..16) and the floor grid. */
  grid?: boolean;
  /** No perspective. */
  ortho?: boolean;
  /** One color per element name instead of per texture key, the names as the legend. */
  colorBy?: "element";
  /** Element name patterns ("*" wildcard) drawn solid, everything else ghosted. */
  highlight?: string[];
  /** Element name patterns left out. */
  hide?: string[];
  /** Leave the legend out (a sheet shows it once). */
  noLegend?: boolean;
}

export interface ModelResult {
  /** Null on success, otherwise why nothing was drawn. */
  error: string | null;
  boxes: number;
  /** Texture keys used by the drawn boxes (without "#"), sorted. */
  textures: string[];
  /** Keys drawn with their real texture. */
  textured: string[];
  animations: { code: string; name: string; frames: number }[];
  /** Whether a worn item's pieces were placed on the player body. */
  placedOnBody: boolean;
}

/** A legend row: the label and its swatch color. */
export interface LegendRow {
  label: string;
  color: string;
}

/** What src/inputs.ts prepared for a schematic: cell-centered boxes (block units) and a color per code. */
export interface SchematicPayload {
  boxes: { x: number; y: number; z: number; sx?: number; sy?: number; sz?: number; quaternion?: [number, number, number, number]; code: number }[];
  codes: string[];
  /** Color per entry of `codes`. */
  colors: string[];
  /** Most common first. */
  legend: LegendRow[];
}

export interface ChiselPayload {
  shape: ChiselShape;
  /** Color per material of `shape`. */
  colors: string[];
  legend: LegendRow[];
}

/** A scene (src/scene.ts): boxes in 1/16 block units whose faces name texture keys, and the images for those keys. */
export interface ScenePayload {
  boxes: import("@nf3t/vs-schematic/shapeBoxes.js").ShapeBox[];
  /** Texture key -> PNG data: URL. */
  textures: Record<string, string>;
}

/** The page's window functions (implemented in page/main.ts). */
export interface PageApi {
  loadModel(raw: unknown, viewDirection: Vec3, options: ModelOptions): Promise<ModelResult>;
  loadSchematic(payload: SchematicPayload, viewDirection: Vec3, options: PageOptions): Promise<{ error: string | null }>;
  loadScene(payload: ScenePayload, viewDirection: Vec3, options: PageOptions): Promise<{ error: string | null }>;
  loadChisel(payload: ChiselPayload, viewDirection: Vec3, options: PageOptions): Promise<{ error: string | null }>;
  /** Poses the loaded model at `frame` of animation `code` (null: the rest pose); `note` is appended to the title. */
  showFrame(code: string | null, frame: number, note: string): void;
  /** A PNG data: URL of a grid of the loaded model at each frame of `code`, each cell labelled. */
  contactSheet(code: string, frames: number[], labels: string[], columns: number): string;
  /** One PNG data: URL of `cells` (PNG data: URLs, all the same size) in a grid of `columns`, each drawn `cell` pixels wide, under a title; `rows` labels the rows (before / after). */
  composeSheet(cells: string[], columns: number, cell: number, title: string, rows?: string[]): Promise<string>;
  /** The RGB of the drawn canvas at (x, y) in CSS pixels from its top-left, read right after a fresh render (tests). */
  samplePixel(x: number, y: number): [number, number, number];
}
