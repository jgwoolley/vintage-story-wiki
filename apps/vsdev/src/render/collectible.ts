// Finds an item or block type by its concrete code (`rod-cupronickel`, `armor-body-antique-forlorn-pristine`) in the game's `itemtypes/` and
// `blocktypes/` JSON, and reads what a scene needs from it: its shape, textures, the player-body elements it hides, and its hand transform.
// The variants are the plain cross product of the variant groups' states (no allowedVariants/skipVariants), so a code the game defines by
// another route (the Forlorn Hope armor is skipped in the cross product but exists) is still found; the code must match exactly.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { BLOCK_HAND_TRANSFORM, ITEM_HAND_TRANSFORM, type HandTransform } from "@nf3t/vs-schematic/shapeBoxes.js";
import { shapeFileRef, type StatueCollectible } from "@nf3t/vs-schematic/statue.js";

type Json = Record<string, unknown>;

export interface Collectible {
  kind: "item" | "block";
  /** The domain folder (`survival`...) the type file is in. */
  domain: string;
  code: string;
  json: Json;
  /** The values of the variant groups, e.g. `{ metal: "cupronickel" }`. */
  groupValues: Record<string, string>;
}

const globToRegExp = (pattern: string): RegExp => (pattern.startsWith("@")
  ? new RegExp(`^${pattern.slice(1)}$`, "i")
  : new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i"));

/** The value of the most specific glob key matching `code` (longer pattern wins, a later one on a tie). */
export function byType<T>(map: Record<string, T> | undefined, code: string): T | undefined {
  let best: { pattern: string; value: T } | undefined;
  for (const [pattern, value] of Object.entries(map ?? {})) {
    if (globToRegExp(pattern).test(code) && (!best || pattern.length >= best.pattern.length)) best = { pattern, value };
  }
  return best?.value;
}

/** `{placeholders}` filled from the variant values. */
export const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

/** A property, looked up the game's way: case-insensitively, and from `<name>ByType` first. */
export function prop<T = unknown>(json: Json, name: string, code: string): T | undefined {
  const lower = name.toLowerCase();
  const key = (suffix: string) => Object.keys(json).find((k) => k.toLowerCase() === lower + suffix);
  const typed = key("bytype");
  if (typed) {
    const hit = byType(json[typed] as Record<string, T>, code);
    if (hit !== undefined) return hit;
  }
  const plain = key("");
  return plain ? (json[plain] as T) : undefined;
}

function walk(dir: string, out: string[]): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.json$/i.test(e.name)) out.push(full);
  }
  return out;
}

const cartesian = (groups: string[][]): string[][] => groups.reduce<string[][]>((acc, states) => acc.flatMap((p) => states.map((s) => [...p, s])), [[]]);

/** Looks `code` up in `<assetsDir>/<domain>/itemtypes|blocktypes`; undefined when no type file defines it. */
export function findCollectible(assetsDir: string, code: string): Collectible | undefined {
  let domains: string[];
  try {
    domains = readdirSync(assetsDir);
  } catch {
    return undefined;
  }
  for (const kind of ["item", "block"] as const) {
    for (const domain of domains) {
      const root = path.join(assetsDir, domain, kind === "item" ? "itemtypes" : "blocktypes");
      let files: string[];
      try {
        files = walk(root, []);
      } catch {
        continue;
      }
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        const base = /\bcode\s*:\s*["']([^"']+)["']/.exec(text)?.[1] ?? /["']code["']\s*:\s*["']([^"']+)["']/.exec(text)?.[1];
        if (!base || (code !== base && !code.startsWith(`${base}-`))) continue;
        let json: Json;
        try {
          json = JSON5.parse(text);
        } catch {
          continue;
        }
        const groups = Array.isArray(json.variantgroups) ? (json.variantgroups as { code?: string; states?: string[] }[]) : [];
        if (!groups.length) {
          if (code === base) return { kind, domain, code, json, groupValues: {} };
          continue;
        }
        if (groups.some((g) => !g.code || !Array.isArray(g.states))) continue;
        for (const combo of cartesian(groups.map((g) => g.states!))) {
          if (`${base}-${combo.join("-")}` === code) return { kind, domain, code, json, groupValues: Object.fromEntries(groups.map((g, i) => [g.code!, combo[i]])) };
        }
      }
    }
  }
  return undefined;
}

/** The shape asset ref (`domain:path`, without `shapes/` or `.json`) the type uses, or undefined. */
export function shapeRef(c: Collectible): { domain: string; path: string } | undefined {
  const shape = prop<{ base?: string }>(c.json, "shape", c.code);
  return shape?.base ? { domain: c.domain, path: fill(shape.base, c.groupValues) } : undefined;
}

/** The type's `textures` (key -> `domain:path`), with the code's `texturesByType` entry laid over them; only the `base` of each is used. */
export function textureRefs(c: Collectible): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (map: Record<string, { base?: string }> | undefined) => {
    for (const [key, t] of Object.entries(map ?? {})) if (t?.base) out[key] = `${c.domain}:${fill(t.base, c.groupValues)}`;
  };
  add(c.json.textures as never);
  add(byType(c.json.texturesByType as Record<string, Record<string, { base?: string }>>, c.code));
  return out;
}

/**
 * The body elements a worn item hides and keeps, lower-cased. The game reads them from `attributes.attachableToEntity` (armor), or for older
 * clothing from `attributes.disableElements` / `keepElements` (`AttributeAttachableToEntity.FromAttributes`); `*ByType` resolved for the code.
 */
export function wornElements(c: Collectible): { disable: string[]; keep: string[] } {
  const attributes = prop<Json>(c.json, "attributes", c.code);
  const attachable = attributes ? prop<Json>(attributes, "attachableToEntity", c.code) : undefined;
  const from = attachable ?? attributes;
  const list = (name: string) => ((from ? prop<string[]>(from, name, c.code) : undefined) ?? []).map((n) => n.toLowerCase());
  return { disable: list("disableElements"), keep: list("keepElements") };
}

/** Names of player-body elements this worn item hides, lower-cased (`wornElements(c).disable`). */
export function disabledElements(c: Collectible): string[] {
  return wornElements(c).disable;
}

/**
 * The element names to remove from a dressed entity, the way the game does it (`BehaviorContainer.addGearToShape`, `Entity.OnTesselation`):
 * every item's disabled elements, plus the entity's own default `disableElements` that no item keeps. Lower-cased.
 */
export function hiddenElements(entityDefaults: string[], worn: { disable: string[]; keep: string[] }[]): Set<string> {
  const pending = new Set(entityDefaults.map((n) => n.toLowerCase()));
  const removed = new Set<string>();
  for (const w of worn) {
    for (const n of w.disable) {
      removed.add(n);
      pending.add(n);
    }
    for (const n of w.keep) pending.delete(n);
  }
  return new Set([...removed, ...pending]);
}

/** The hand transform for third person: the game's default for an item/block, with the type's own `tpHandTransform` values laid over it. */
export function handTransform(c: Collectible, field_ = "tpHandTransform"): HandTransform {
  const base = c.kind === "item" ? ITEM_HAND_TRANSFORM : BLOCK_HAND_TRANSFORM;
  const t = prop<Json>(c.json, field_, c.code);
  if (!t) return base;
  const vec = (v: unknown, d: [number, number, number]): [number, number, number] => {
    const o = (v ?? {}) as Record<string, number>;
    const get = (k: string) => Object.entries(o).find(([n]) => n.toLowerCase() === k)?.[1];
    return [get("x") ?? d[0], get("y") ?? d[1], get("z") ?? d[2]];
  };
  const field = (name: string) => Object.entries(t).find(([n]) => n.toLowerCase() === name)?.[1];
  const scale = field("scale");
  return {
    translation: vec(field("translation"), base.translation),
    rotation: vec(field("rotation"), base.rotation),
    origin: vec(field("origin"), base.origin),
    scale: typeof scale === "number" ? scale : base.scale,
  };
}

/**
 * What a statue (`@nf3t/vs-schematic/statue.js`) needs of a worn or held type: its shape, how it is worn (the game's
 * `IAttachableToEntity.FromAttributes`: `attributes.attachableToEntity`, or old clothing's `attributes.wearableAttachment`) and its hand
 * transforms. Shape refs keep the type's own domain folder (`survival:`), which is where the game's files are.
 */
export function statueCollectible(c: Collectible): StatueCollectible {
  const own = shapeRef(c);
  const shape = prop<{ base?: string; rotateX?: number; rotateY?: number; rotateZ?: number }>(c.json, "shape", c.code);
  const attributes = prop<Json>(c.json, "attributes", c.code);
  const attachable = attributes ? prop<Json>(attributes, "attachableToEntity", c.code) : undefined;
  let worn: StatueCollectible["worn"];
  if (attachable || (attributes && prop(attributes, "wearableAttachment", c.code))) {
    const from = attachable ?? attributes!;
    const list = (name: string) => (prop<string[]>(from, name, c.code) ?? []).map(String);
    // GetAttachedShape: attachedShape, else the "default" slot's entry of attachedShapeBySlotCode, else the item's own shape.
    const bySlot = attachable ? prop<Record<string, { base?: string }>>(attachable, "attachedShapeBySlotCode", c.code) : undefined;
    const attached = (attachable ? prop<{ base?: string }>(attachable, "attachedShape", c.code) : undefined) ?? byType(bySlot, "default");
    worn = {
      ...(attached?.base ? { shape: shapeFileRef(fill(attached.base, c.groupValues), c.domain) } : {}),
      disable: list("disableElements"),
      keep: list("keepElements"),
    };
  }
  const offHand = prop<Json>(c.json, "tpOffHandTransform", c.code) ? handTransform(c, "tpOffHandTransform") : undefined;
  return {
    ...(own ? { shape: shapeFileRef(own.path, own.domain) } : {}),
    ...(shape && (shape.rotateX || shape.rotateY || shape.rotateZ) ? { shapeRotation: [shape.rotateX ?? 0, shape.rotateY ?? 0, shape.rotateZ ?? 0] as [number, number, number] } : {}),
    ...(worn ? { worn } : {}),
    hand: handTransform(c),
    ...(offHand ? { offHand } : {}),
  };
}
