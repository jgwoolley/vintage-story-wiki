// Inventory icons: a block's `guiTransform` centres the model in the slot and scales it to fit. Worked out from a built shape's bounds
// (the same numbers `vsdev shape` prints) and, with a spec's "gui" setting, written into the blocktype's `guiTransformByType`.
import { readFileSync, writeFileSync } from "node:fs";
import { SpecError } from "../gen/spec.js";
import type { Bounds } from "./bounds.js";

export interface GuiConfig {
  /** The blocktype file to keep up to date (relative to the spec file). */
  file?: string;
  /** Its guiTransformByType key for each shape; "{name}" is the shape's name (default "*-{name}-*"). */
  key?: string;
  /** The turn (degrees about y) of the variant the inventory shows, as in its shape's "rotateY" (default 0). */
  rotateY?: number;
  /** The icon's rotation [x, y, z] (default [-22.6, -45.3, 0], the usual block view); an entry already in the file keeps its own. */
  rotation?: [number, number, number];
  /** How many blocks the model's longest side fills (default 0.95). */
  fit?: number;
  /** The largest scale (default 1.1: a small model is not blown up). */
  maxScale?: number;
  /** An entry already in the file keeps its scale (tuned by eye); only its origin follows the model. New entries are computed. */
  keepScale?: boolean;
}

export interface GuiTransform { rotation: { x: number; y: number; z: number }; origin: { x: number; y: number; z: number }; scale: number }

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

/** The icon transform that centres `bounds` (shape units) and makes its longest side `fit` blocks. */
export function guiTransform(bounds: Bounds, cfg: GuiConfig = {}): GuiTransform {
  const c = bounds.min.map((v, i) => (v + bounds.max[i]) / 2);
  // Turn the centre about the block's middle as the variant is turned (the renderer's Ry: x' = x cos + z sin, z' = -x sin + z cos).
  const a = ((cfg.rotateY ?? 0) * Math.PI) / 180, dx = c[0] - 8, dz = c[2] - 8;
  const x = 8 + dx * Math.cos(a) + dz * Math.sin(a), z = 8 - dx * Math.sin(a) + dz * Math.cos(a);
  const longest = Math.max(...bounds.max.map((v, i) => v - bounds.min[i])) / 16;
  const [rx, ry, rz] = cfg.rotation ?? [-22.6, -45.3, 0];
  return {
    rotation: { x: rx, y: ry, z: rz },
    origin: { x: r2(x / 16), y: r2(c[1] / 16), z: r2(z / 16) },
    scale: r2(Math.min(cfg.maxScale ?? 1.1, (cfg.fit ?? 0.95) / Math.max(longest, 1e-6))),
  };
}

const fmt = (t: GuiTransform) =>
  `{ "rotation": { "x": ${t.rotation.x}, "y": ${t.rotation.y}, "z": ${t.rotation.z} }, "origin": { "x": ${t.origin.x}, "y": ${t.origin.y}, "z": ${t.origin.z} }, "scale": ${t.scale} }`;

/**
 * Writes the transforms into the blocktype's `guiTransformByType`, one line per key, the rest of the file untouched: an existing line
 * is replaced (keeping its rotation, and with `keepScale` its scale), a new key goes at the top of the block. Returns the keys added
 * and changed.
 */
export function writeGuiTransforms(file: string, entries: [string, GuiTransform][], opts: { keepScale?: boolean } = {}): { added: string[]; changed: string[] } {
  let text = readFileSync(file, "utf8");
  const open = /^([ \t]*)"?guiTransformByType"?\s*:\s*\{[ \t]*$/m.exec(text);
  if (!open) throw new SpecError(`gui: ${file} has no "guiTransformByType": { on a line of its own; add one (it can be empty) and run again`);
  const added: string[] = [], changed: string[] = [];
  for (const [key, t] of entries) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const line = new RegExp(`^([ \\t]*)"${esc}"\\s*:\\s*(\\{.*\\})(,?)[ \\t]*$`, "m").exec(text);
    if (line) {
      const rot = /"rotation"\s*:\s*\{\s*"x"\s*:\s*([-\d.]+)\s*,\s*"y"\s*:\s*([-\d.]+)\s*,\s*"z"\s*:\s*([-\d.]+)\s*\}/.exec(line[2]);
      const scale = opts.keepScale ? /"scale"\s*:\s*([-\d.]+)/.exec(line[2]) : null;
      const keep = { ...t, ...(rot ? { rotation: { x: Number(rot[1]), y: Number(rot[2]), z: Number(rot[3]) } } : {}), ...(scale ? { scale: Number(scale[1]) } : {}) };
      const next = `${line[1]}"${key}": ${fmt(keep)}${line[3]}`;
      if (next !== line[0]) {
        text = text.slice(0, line.index) + next + text.slice(line.index + line[0].length);
        changed.push(key);
      }
    } else {
      const at = open.index + open[0].length;
      const indent = open[1] + (/\t/.test(open[1]) ? "\t" : "  ");
      // The block's first entry decides whether a comma is needed (an empty block gets none).
      const rest = text.slice(at).replace(/^\s*/, "");
      text = text.slice(0, at) + `\n${indent}"${key}": ${fmt(t)}${rest.startsWith("}") ? "" : ","}` + text.slice(at);
      added.push(key);
    }
  }
  if (added.length || changed.length) writeFileSync(file, text);
  return { added, changed };
}
