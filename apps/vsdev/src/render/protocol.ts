// What the Node half (render.ts) passes to the page's window functions (page/main.ts) and gets back. No DOM types, so both the root
// tsconfig (Node) and the page's DOM tsconfig can import it.
import type { ChiselShape } from "vs-schematic/chisel.js";
import type { Vec3 } from "./views.js";

export interface PageOptions {
  /** Draw the one-block floor grid. */
  floor: boolean;
  /** Shown top left, and the canvas's accessible name. */
  title: string;
}

export interface ModelOptions extends PageOptions {
  /** Texture key -> PNG data: URL; empty draws untextured. */
  textures: Record<string, string>;
  /** The player body shape, for a worn item's stepParentName pieces. */
  body?: unknown;
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
  boxes: { x: number; y: number; z: number; sx?: number; sy?: number; sz?: number; code: number }[];
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

/** The page's window functions (implemented in page/main.ts). */
export interface PageApi {
  loadModel(raw: unknown, viewDirection: Vec3, options: ModelOptions): Promise<ModelResult>;
  loadSchematic(payload: SchematicPayload, viewDirection: Vec3, options: PageOptions): { error: string | null };
  loadChisel(payload: ChiselPayload, viewDirection: Vec3, options: PageOptions): { error: string | null };
  /** Poses the loaded model at `frame` of animation `code` (null: the rest pose); `note` is appended to the title. */
  showFrame(code: string | null, frame: number, note: string): void;
  /** A PNG data: URL of a grid of the loaded model at each frame of `code`, each cell labelled. */
  contactSheet(code: string, frames: number[], labels: string[], columns: number): string;
  /** The RGB of the drawn canvas at (x, y) in CSS pixels from its top-left, read right after a fresh render (tests). */
  samplePixel(x: number, y: number): [number, number, number];
}
