// Block colors for the schematic viewers. The real colors come from a JSON file produced by the
// BlockColorMod game mod (https://github.com/jgwoolley/translocator-locator-cmd): `"domain:code"` ->
// `{ hex, alpha }` (hex is byte-swapped, see parseBlockColors). Blocks missing from the map fall back to a hash-derived color
// (stringToColor), so a stale file degrades to "some blocks look random", never to a failure.
// Pure except loadBlockColors, which touches localStorage (guarded: it can be absent or throw).
import { stringToColor } from "./schematicVoxels.js";

/** `"domain:code"` -> `"#rrggbb"`. */
export type BlockColors = ReadonlyMap<string, string>;

const HEX = /^#[0-9a-f]{6}$/i;

/** localStorage key holding a user-uploaded color file (raw JSON text) that overrides the bundled one. */
export const BLOCK_COLORS_STORAGE_KEY = "vsWiki.blockColors";

/**
 * Validates and flattens a BlockColorMod file, converting its BGR hex to RGB. Entries without a `#RRGGBB` hex are skipped; throws if
 * the input isn't an object or contains no usable entry at all (so a wrong file is rejected up front).
 * Alpha is ignored: the file reports 0 for every block, and the voxel viewer draws opaque cubes.
 */
export function parseBlockColors(json: unknown): BlockColors {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Not a block color file (expected a JSON object).");
  const colors = new Map<string, string>();
  for (const [code, value] of Object.entries(json)) {
    const hex = (value as { hex?: unknown } | null)?.hex;
    // The mod's "hex" is actually BGR (soil is #1D3954, copper #3B60AA), so swap red and blue.
    if (typeof hex === "string" && HEX.test(hex)) colors.set(code, `#${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toLowerCase());
  }
  if (!colors.size) throw new Error('No block colors found (expected entries like "game:rock-granite": { "hex": "#808080" }).');
  return colors;
}

/** Color for a schematic block code: the mapped color if known (the "game:" domain is optional), else a stable hash color. */
export function blockColor(code: string, colors?: BlockColors | null): string {
  if (colors) {
    const hit = colors.get(code) ?? (code.includes(":") ? undefined : colors.get(`game:${code}`));
    if (hit) return hit;
  }
  return stringToColor(code);
}

export interface LoadedBlockColors {
  colors: BlockColors | null;
  /** `"uploaded"` when the browser's stored override is in use, `"bundled"` for the file shipped with the site, `"none"` if neither loaded. */
  source: "uploaded" | "bundled" | "none";
}

/** Loads the user's stored override if there is one, else fetches the bundled file at `bundledUrl`. Never throws. */
export async function loadBlockColors(bundledUrl: string): Promise<LoadedBlockColors> {
  try {
    const stored = localStorage.getItem(BLOCK_COLORS_STORAGE_KEY);
    if (stored) return { colors: parseBlockColors(JSON.parse(stored)), source: "uploaded" };
  } catch {
    // no storage, or a corrupt stored value: fall through to the bundled file
  }
  try {
    const response = await fetch(bundledUrl);
    if (response.ok) return { colors: parseBlockColors(await response.json()), source: "bundled" };
  } catch (err) {
    console.error("Couldn't load block colors; using generated colors", err);
  }
  return { colors: null, source: "none" };
}

/** Validates `text` and stores it as the override. Throws on invalid JSON/content; returns false if storage refused it (e.g. quota). */
export function saveBlockColorsOverride(text: string): { colors: BlockColors; stored: boolean } {
  const colors = parseBlockColors(JSON.parse(text));
  try {
    localStorage.setItem(BLOCK_COLORS_STORAGE_KEY, text);
    return { colors, stored: true };
  } catch {
    return { colors, stored: false };
  }
}

export function clearBlockColorsOverride(): void {
  try {
    localStorage.removeItem(BLOCK_COLORS_STORAGE_KEY);
  } catch {
    // nothing stored to clear
  }
}
