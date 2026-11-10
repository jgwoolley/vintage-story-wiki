// A "scene": several models placed in one image, e.g. a broken translocator with a player in Forlorn Hope armor next to it holding a rod.
// Everything is turned into one list of boxes (1/16 block units) with its own texture keys, which the page draws like any model. Parts are
//   { model, at, rotationY, scale }     a shape file or `domain:path`, placed with its block corner at `at` (blocks; x east, y up, z south)
//   { player: { wear, hold, ... }, at, rotationY }   the seraph body in an animation pose, dressed in worn items (their shapes hang on the
//                                       body's bones, the body elements they disable are hidden) and holding items in its hands at the
//                                       game's hand attachment points (`holdInHand`), standing with its feet at `at`.
// Either kind takes `material`: one texture (`game:block/stone/rock/whitemarble1`) for every face of the part, worn and held items
// included, the way a carved statue is drawn: each face keeps its UVs, only the image is swapped.
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSON5 from "json5";
import {
  compactShape, elementFrame, holdInHand, rotationMatrix, samplePose, shapeToBoxes, transformBoxes,
  type CompactShape, type ShapeBox, type ShapeElement,
} from "@nf3t/vs-schematic/shapeBoxes.js";
import { resolveTextures } from "@nf3t/vs-schematic/textureFiles.js";
import { buildStatue, emptyStatueDesign, type StatueDesign } from "@nf3t/vs-schematic/statue.js";
import { statueIo } from "./statues.js";
import { findCollectible, hiddenElements, wornElements, handTransform, shapeRef, textureRefs, type Collectible } from "./collectible.js";


type Vec3 = [number, number, number];

export interface PlayerSpec {
  /** Worn items by code, e.g. `armor-body-antique-forlorn-pristine`. */
  wear?: string[];
  /** Item or block code held in the right / left hand. */
  hold?: string;
  holdLeft?: string;
  /** Multiplier on the game's hand scale for held items (default 1): the item grows about its own center, so it stays in the hand. The game draws most items small there, so raise it to make a held item readable. */
  holdScale?: number;
  /** A hair color of `textures/entity/humanoid/seraphskinparts/hair/` (default lightgray). */
  hair?: string;
  /** An animation of the body shape (`idle1`, `helditemready`...) and the frame to hold; default the rest pose. */
  animation?: string;
  frame?: number;
}

/** Where a player looks: its own front is west (-x) at rotationY 0; positive rotationY turns it counter-clockwise seen from above. */
export type Facing = "north" | "east" | "south" | "west";
const FACING_DEGREES: Record<Facing, number> = { west: 0, south: 90, east: 180, north: 270 };

/**
 * A statue of the Player Statues mod (nf3tstatue), drawn the way the mod draws it (`@nf3t/vs-schematic/statue.js`). Fields are the
 * block entity's (StatueAppearance); codes are item/block codes of the game's types (`armor-head-plate-tinbronze`).
 */
export interface StatueSpec {
  /** The statue block: `nf3tstatue:statue-<small|large|bust>-<rock>` or `nf3tstatue:statuemetal-<size>-<metal>`. */
  block: string;
  /** `player` (default) or a special statue (`robot`). */
  type?: string;
  /** An emote of the seraph (`cheer`, `wave`...), `none` (standing) or `riding`. */
  emote?: string;
  /** The emote's frame; default (-1) is its most expressive keyframe, as in the mod. */
  frame?: number;
  /** Skin part shapes (hair, beard...), e.g. `game:entity/humanoid/seraphskinparts/hair-base/ponytail` (domain:path without shapes/ and .json). */
  skin?: string[];
  clothing?: string[];
  armor?: string[];
  hold?: string;
  holdLeft?: string;
  /** `elkcow` or `elkbull`: the player sits on a stone elk. */
  mount?: string;
  elkPose?: "stand" | "walk" | "gallop";
  elkFrame?: number;
  antlers?: number;
  tack?: { bridle?: string; face?: string; saddle?: string; bags?: string };
  noPedestal?: boolean;
  /** Pieces of fire clay packed around it (a mold in progress). */
  clay?: number;
}

export type ScenePartSpec =
  | { model: string; at?: Vec3; rotationY?: number; scale?: number; animation?: string; frame?: number; material?: string }
  | { player: PlayerSpec; at?: Vec3; rotationY?: number; facing?: Facing; scale?: number; material?: string }
  | { statue: StatueSpec; at?: Vec3; rotationY?: number; facing?: Facing; scale?: number };

/** A scene's statue spec as the block entity's design. */
export function statueDesignOf(spec: StatueSpec): StatueDesign {
  const code = (c: string) => (c.includes(":") ? c : `game:${c}`);
  const d = emptyStatueDesign(spec.block);
  return {
    ...d,
    type: spec.type ?? d.type,
    emote: spec.emote ?? (spec.type && spec.type !== "player" ? "" : "none"),
    frame: spec.frame ?? -1,
    skinShapes: spec.skin ?? [],
    clothing: (spec.clothing ?? []).map(code),
    armor: (spec.armor ?? []).map(code),
    ...(spec.hold ? { rightHand: code(spec.hold) } : {}),
    ...(spec.holdLeft ? { leftHand: code(spec.holdLeft) } : {}),
    mount: spec.mount ?? "",
    elkPose: spec.elkPose ?? "stand",
    elkFrame: spec.elkFrame ?? -1,
    antlers: spec.antlers ?? d.antlers,
    tack: [spec.tack?.bridle ?? "", spec.tack?.face ?? "", spec.tack?.saddle ?? "", spec.tack?.bags ?? ""],
    noPedestal: !!spec.noPedestal,
    clayLevel: spec.clay ?? 0,
  };
}

export interface SceneIo {
  /** Absolute path of an asset by `domain:path` (the game's assets or a mod); `.json` may be missing. Undefined when not found. */
  findFile(ref: string): string | undefined;
  /** The game client's `assets` folder, for textures (undefined: untextured). */
  gameAssets?: string;
  /** The `assets` folder the item/block type files are read from. */
  typesAssets?: string;
  /** Reads a file, trying other cases (the game ignores case), or undefined. */
  read(file: string): Promise<Uint8Array | undefined>;
}

export interface SceneResult {
  boxes: ShapeBox[];
  /** Texture key -> PNG data: URL, for the keys in `boxes`. */
  textures: Record<string, string>;
  /** Things the user should know (texture or model not found). */
  warnings: string[];
}

const BODY_SHAPE = "game:shapes/entity/humanoid/seraph.json";
/** The player entity, whose `attributes.disableElements` are hidden unless a worn item keeps them. */
const PLAYER_ENTITY = "game:entities/humanoid/player.json";
/** player.json's `disableElements` (1.21), used when the entity file can't be read. */
const PLAYER_DISABLED = ["hair-covered", "showshoeR", "showshoeL", "hoodtight"];

/** A shape with its texture keys prefixed and its face UVs divided by the texture sizes, so shapes of different textures can share a tree. */
function isolate(shape: CompactShape, prefix: string): CompactShape {
  const sizeOf = (key: string): [number, number] => shape.textureSizes?.[key] ?? shape.textureSize ?? [16, 16];
  const visit = (el: ShapeElement): ShapeElement => {
    const faces = el.faces && Object.fromEntries(Object.entries(el.faces).map(([side, f]) => {
      const [w, h] = sizeOf(f!.texture);
      const [u1, v1, u2, v2] = f!.uv;
      return [side, { ...f!, texture: `${prefix}${f!.texture}`, uv: [u1 / w, v1 / h, u2 / w, v2 / h] }];
    }));
    return {
      ...el,
      ...(el.texture !== undefined ? { texture: `${prefix}${el.texture}` } : {}),
      ...(faces ? { faces } : {}),
      ...(el.children ? { children: el.children.map(visit) } : {}),
    };
  };
  return { ...shape, elements: shape.elements.map(visit), textureSize: [1, 1], textureSizes: undefined };
}

function removeNamed(elements: ShapeElement[], names: Set<string>): ShapeElement[] {
  return elements
    // The game's Shape.RemoveElements also removes "skinpart-<name>".
    .filter((e) => !(e.name && (names.has(e.name.toLowerCase()) || names.has(e.name.toLowerCase().replace(/^skinpart-/, "")))))
    .map((e) => (e.children ? { ...e, children: removeNamed(e.children, names) } : e));
}

function find(elements: ShapeElement[], name: string): ShapeElement | undefined {
  for (const el of elements) {
    if (el.name === name) return el;
    const hit = el.children && find(el.children, name);
    if (hit) return hit;
  }
  return undefined;
}

/** Hangs each worn shape's `stepParent` elements under the body bone they name (the game does the same); other elements stay loose. */
function dress(body: CompactShape, worn: CompactShape[]): CompactShape {
  // The body itself has parts that hang on a bone (eyes, hair: `stepParentName: Head`); seat them first.
  const own = body.elements.filter((e) => e.stepParent);
  const elements = structuredClone(body.elements.filter((e) => !e.stepParent));
  for (const piece of [{ ...body, elements: own }, ...worn]) {
    for (const el of structuredClone(piece.elements)) {
      const parent = el.stepParent ? find(elements, el.stepParent) : undefined;
      if (parent) (parent.children ??= []).push(el);
      else elements.push(el);
    }
  }
  return { ...body, elements };
}

const bounds = (boxes: ShapeBox[]) => {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    const r = Math.max(b.sx, b.sy, b.sz) / 2;
    for (const [i, v, s] of [[0, b.x, r], [1, b.y, r], [2, b.z, r]] as const) {
      lo[i] = Math.min(lo[i], v - s);
      hi[i] = Math.max(hi[i], v + s);
    }
  }
  return { lo, hi };
};

export async function buildScene(parts: ScenePartSpec[], io: SceneIo): Promise<SceneResult> {
  const out: SceneResult = { boxes: [], textures: {}, warnings: [] };
  let n = 0;

  /**
   * Loads a shape file and its textures (the shape's own, with `override` keys laid over them), prefixed so keys don't collide. With a
   * `material`, every texture key the shape declares or its faces use is that one texture instead.
   */
  async function load(ref: string, override: Record<string, string> = {}, material?: string): Promise<{ shape: CompactShape; raw: Record<string, unknown> } | undefined> {
    const file = io.findFile(ref);
    if (!file) {
      out.warnings.push(`shape ${ref} not found`);
      return undefined;
    }
    const raw = JSON5.parse(Buffer.from(await readFile(file)).toString("utf8")) as Record<string, unknown>;
    raw.textures = { ...((raw.textures as Record<string, string>) ?? {}), ...override };
    if (material) raw.textures = Object.fromEntries([...new Set([...Object.keys(raw.textures as object), ...faceTextureKeys(raw.elements)])].map((k) => [k, material]));
    const prefix = `p${n++}:`;
    const textured = !!io.gameAssets;
    const shape = isolate(compactShape(raw, { faces: textured }), prefix);
    if (textured) {
      const resolved = await resolveTextures(raw, path.resolve(file).split(path.sep).join("/"), io.gameAssets, io.read);
      for (const [key, url] of Object.entries(resolved.images)) out.textures[`${prefix}${key}`] = url;
      for (const m of resolved.missing) out.warnings.push(`texture #${m.key} ${m.ref} not found (${ref})`);
    }
    return { shape, raw };
  }

  /** Shape ref of a collectible: its own domain first, then the vanilla ones. */
  async function loadCollectible(c: Collectible, material?: string): Promise<{ shape: CompactShape; raw: Record<string, unknown> } | undefined> {
    const s = shapeRef(c);
    if (!s) {
      out.warnings.push(`${c.code} has no shape`);
      return undefined;
    }
    const refs = [...new Set([c.domain, "game", "survival", "creative"])].map((d) => `${d}:shapes/${s.path}`);
    const ref = refs.find((r) => io.findFile(r)) ?? refs[0];
    return load(ref, textureRefs(c), material);
  }

  let playerDefaults: string[] | undefined;
  /** The player entity's default `disableElements`, read once. */
  async function playerDisabled(): Promise<string[]> {
    if (playerDefaults) return playerDefaults;
    playerDefaults = PLAYER_DISABLED;
    const file = io.findFile(PLAYER_ENTITY);
    if (file) {
      try {
        const json = JSON5.parse(Buffer.from(await readFile(file)).toString("utf8")) as { attributes?: { disableElements?: unknown } };
        const list = json.attributes?.disableElements;
        if (Array.isArray(list)) playerDefaults = list.map(String);
      } catch {
        // unreadable: keep the built-in list
      }
    }
    return playerDefaults;
  }

  const lookup = (code: string): Collectible | undefined => {
    const c = io.typesAssets ? findCollectible(io.typesAssets, code) : undefined;
    if (!c) out.warnings.push(`no item or block ${code} in the game's itemtypes/blocktypes`);
    return c;
  };

  // Turns and scales about `pivot` (a model's block bottom center, a player's feet), then moves to `at`, like the game scales block meshes.
  const place = (boxes: ShapeBox[], at: Vec3 = [0, 0, 0], rotationY = 0, pivot: Vec3, scale = 1) => {
    const r = rotationMatrix(0, rotationY, 0);
    const rp = [0, 1, 2].map((i) => scale * (r[i * 3] * pivot[0] + r[i * 3 + 1] * pivot[1] + r[i * 3 + 2] * pivot[2]));
    return transformBoxes(boxes, r, [pivot[0] - rp[0] + at[0] * 16, pivot[1] - rp[1] + at[1] * 16, pivot[2] - rp[2] + at[2] * 16], scale);
  };

  for (const part of parts) {
    if ("statue" in part) {
      // Turned by the part's own rotationY/facing (about the block's bottom center, as the mod turns it), not the design's angle.
      const statue = await buildStatue(statueDesignOf(part.statue), statueIo(io.findFile, io.typesAssets), { rotate: false });
      out.warnings.push(...new Set(statue.warnings));
      const prefix = `p${n++}:`;
      if (io.gameAssets) {
        const resolved = await resolveTextures({ textures: statue.textures }, "", io.gameAssets, io.read);
        for (const [key, url] of Object.entries(resolved.images)) out.textures[`${prefix}${key}`] = url;
        for (const m of resolved.missing) out.warnings.push(`texture ${m.ref} not found (statue)`);
      }
      const boxes = statue.boxes.map((b) => ({
        ...b, texture: `${prefix}${b.texture ?? "stone"}`, ...(b.faces ? { faces: b.faces.map((f) => ({ ...f, texture: `${prefix}${f.texture}` })) } : {}),
      }));
      out.boxes.push(...place(boxes, part.at, part.rotationY ?? (part.facing ? FACING_DEGREES[part.facing] : 0), [8, 0, 8], part.scale));
      continue;
    }
    if ("model" in part) {
      const loaded = await load(part.model, {}, part.material);
      if (!loaded) continue;
      const animation = loaded.shape.animations?.find((a) => a.code === part.animation);
      const boxes = shapeToBoxes(loaded.shape, animation ? samplePose(animation, part.frame ?? 0) : undefined);
      out.boxes.push(...place(boxes, part.at, part.rotationY, [8, 0, 8], part.scale));
      continue;
    }

    // A player: the body, its worn items, then what it holds.
    const spec = part.player;
    const worn = (spec.wear ?? []).map(lookup);
    const hair: Record<string, string> = spec.hair ? { hair: `game:entity/humanoid/seraphskinparts/hair/${spec.hair}` } : {};
    const body = await load(BODY_SHAPE, hair, part.material);
    if (!body) continue;
    const pieces: CompactShape[] = [];
    for (const c of worn) {
      if (!c) continue;
      const piece = await loadCollectible(c, part.material);
      if (piece) pieces.push(piece.shape);
    }
    const hidden = hiddenElements(await playerDisabled(), worn.filter((c): c is Collectible => !!c).map(wornElements));
    const clothed = dress(body.shape, pieces);
    const dressed = { ...clothed, elements: removeNamed(clothed.elements, hidden) };
    const animation = body.shape.animations?.find((a) => a.code === spec.animation);
    if (spec.animation && !animation) out.warnings.push(`the player body has no animation ${spec.animation}; it has ${(body.shape.animations ?? []).map((a) => a.code).join(", ")}`);
    const pose = animation ? samplePose(animation, spec.frame ?? 0) : undefined;
    let boxes = shapeToBoxes(dressed, pose);
    if (!boxes.length) continue;
    // Feet at `at`, centered on it.
    const { lo, hi } = bounds(boxes);
    const cx = (lo[0] + hi[0]) / 2;
    const cz = (lo[2] + hi[2]) / 2;
    const toFeet = (b: ShapeBox[]) => transformBoxes(b, rotationMatrix(0, 0, 0), [-cx, -lo[1], -cz]);
    boxes = toFeet(boxes);

    const holdings: [string | undefined, string, string][] = [[spec.hold, "ItemAnchor", "RightHand"], [spec.holdLeft, "ItemAnchorL", "LeftHand"]];
    for (const [code, anchorName, attachCode] of holdings) {
      if (!code) continue;
      const c = lookup(code);
      const anchor = elementFrame(dressed, anchorName, pose);
      const item = c && anchor ? await loadCollectible(c, part.material) : undefined;
      if (!c || !item) continue;
      if (!anchor) {
        out.warnings.push(`the player body has no ${anchorName}`);
        continue;
      }
      const attach = attachmentPoint(body.raw, attachCode) ?? { pos: [0, 0, 0] as Vec3, rot: [0, 0, 0] as Vec3 };
      const hand = handTransform(c);
      // holdScale grows the item about its own origin, so it still sits in the hand.
      const k = spec.holdScale ?? 1;
      const o = hand.origin.map((v) => v * 16) as Vec3;
      const itemBoxes = k === 1 ? shapeToBoxes(item.shape) : transformBoxes(shapeToBoxes(item.shape), rotationMatrix(0, 0, 0), [o[0] * (1 - k), o[1] * (1 - k), o[2] * (1 - k)], k);
      boxes.push(...toFeet(holdInHand(itemBoxes, anchor, attach, hand)));
    }
    out.boxes.push(...place(boxes, part.at, part.rotationY ?? (part.facing ? FACING_DEGREES[part.facing] : 0), [0, 0, 0], part.scale));
  }
  return out;
}

/** Every texture key (without its `#`) the faces of a raw shape's elements use, children included. */
function faceTextureKeys(elements: unknown, out = new Set<string>()): Set<string> {
  for (const el of (Array.isArray(elements) ? elements : []) as Record<string, unknown>[]) {
    for (const face of Object.values((el.faces as Record<string, { texture?: unknown }> | undefined) ?? {})) {
      if (typeof face?.texture === "string") out.add(face.texture.replace(/^#/, ""));
    }
    faceTextureKeys(el.children, out);
  }
  return out;
}

/** An attachment point (`RightHand`...) of a raw shape: position in 1/16 units and rotation in degrees. */
function attachmentPoint(raw: Record<string, unknown>, code: string): { pos: Vec3; rot: Vec3 } | undefined {
  const visit = (els: unknown): { pos: Vec3; rot: Vec3 } | undefined => {
    for (const el of (Array.isArray(els) ? els : []) as Record<string, unknown>[]) {
      for (const ap of (Array.isArray(el.attachmentpoints) ? el.attachmentpoints : []) as Record<string, unknown>[]) {
        if (ap.code === code) {
          const num = (k: string) => Number(ap[k] ?? 0);
          return { pos: [num("posX"), num("posY"), num("posZ")], rot: [num("rotationX"), num("rotationY"), num("rotationZ")] };
        }
      }
      const inner = visit(el.children);
      if (inner) return inner;
    }
    return undefined;
  };
  return visit(raw.elements);
}
