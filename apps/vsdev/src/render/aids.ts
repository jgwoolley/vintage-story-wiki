// The drawing aids for someone making a model (`vsdev render --grid / --color-by element / --highlight / --hide`), as plain data,
// shared by the CLI (Node: checking the names given) and the page (browser: drawing), so it has no imports.

/** A guide box in the model's 1/16 block units: center, size and the guide it belongs to. */
export interface GuideBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  /** "guide:x" | "guide:y" | "guide:z" (the axes) or "guide:block" (the outline of the block). */
  texture: string;
}

export const GUIDE_COLORS: Record<string, string> = { "guide:x": "#e0483c", "guide:y": "#4caf50", "guide:z": "#3d7fe0", "guide:block": "#c9c9c9" };

/** How far the axes run from the origin: past the block's far side, so their ends show beside a block-sized model. */
export const AXIS_LENGTH = 22;

/** Where each axis's name goes, and what it says. */
export const AXIS_LABELS: { at: [number, number, number]; text: string; color: string }[] = [
  { at: [AXIS_LENGTH + 1, 0, 0], text: "+x east", color: GUIDE_COLORS["guide:x"] },
  { at: [0, AXIS_LENGTH + 1, 0], text: "+y up", color: GUIDE_COLORS["guide:y"] },
  { at: [0, 0, AXIS_LENGTH + 1], text: "+z south", color: GUIDE_COLORS["guide:z"] },
  { at: [0, 0, 0], text: "0,0,0", color: "#e8e6e3" },
  { at: [16, 16, 16], text: "16,16,16", color: "#e8e6e3" },
];

/** The three axes from the origin and the twelve edges of the block (0..16 on each axis), as thin boxes. */
export function guideBoxes(): GuideBox[] {
  const out: GuideBox[] = [];
  const t = 0.3, e = 0.12, L = AXIS_LENGTH;
  out.push({ x: L / 2, y: 0, z: 0, sx: L, sy: t, sz: t, texture: "guide:x" });
  out.push({ x: 0, y: L / 2, z: 0, sx: t, sy: L, sz: t, texture: "guide:y" });
  out.push({ x: 0, y: 0, z: L / 2, sx: t, sy: t, sz: L, texture: "guide:z" });
  for (const a of [0, 16]) for (const b of [0, 16]) {
    out.push({ x: 8, y: a, z: b, sx: 16, sy: e, sz: e, texture: "guide:block" });
    out.push({ x: a, y: 8, z: b, sx: e, sy: 16, sz: e, texture: "guide:block" });
    out.push({ x: a, y: b, z: 8, sx: e, sy: e, sz: 16, texture: "guide:block" });
  }
  return out;
}

const patternRegExp = (pattern: string) => new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");

/**
 * Whether an element (by its `path`: the names from its top-level ancestor down, joined with "/") is named by one of `patterns`:
 * a pattern matches the element's own name or any ancestor's (so naming a group names its children), "*" standing for any run of
 * characters; a pattern with a "/" is matched against the whole path instead.
 */
export function matchesElement(path: string, patterns: string[]): boolean {
  const names = path.split("/");
  return patterns.some((p) => (p.includes("/") ? patternRegExp(p).test(path) : names.some((n) => patternRegExp(p).test(n))));
}

/** Every element's path in a shape (the game's shape JSON), groups included. */
export function elementPaths(raw: unknown): string[] {
  const out: string[] = [];
  const walk = (els: unknown, parent: string) => {
    if (!Array.isArray(els)) return;
    for (const el of els) {
      if (!el || typeof el !== "object") continue;
      const path = parent ? `${parent}/${String((el as { name?: unknown }).name ?? "")}` : String((el as { name?: unknown }).name ?? "");
      out.push(path);
      walk((el as { children?: unknown }).children, path);
    }
  };
  walk((raw as { elements?: unknown } | null)?.elements, "");
  return out;
}

/** The patterns that name no element of the shape. */
export function unmatchedPatterns(raw: unknown, patterns: string[]): string[] {
  const paths = elementPaths(raw);
  return patterns.filter((p) => !paths.some((path) => matchesElement(path, [p])));
}

/** A color for the nth distinct element name: hues a golden angle apart, in three brightness bands, so neighbours differ. */
export function elementColor(n: number): string {
  const hue = (n * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, ${[70, 55, 80][n % 3]}%, ${[58, 42, 70][n % 3]}%)`;
}
