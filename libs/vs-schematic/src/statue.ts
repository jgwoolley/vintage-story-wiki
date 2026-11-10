// Statues of the GildedChronicles "Player Statues" mod (modid nf3tstatue, ../translocator-locator-cmd/StatueMod): a statue block has no
// shape file for what it shows. The mod builds it in code from the game's own shapes (StatueMesh.Build): the faceless seraph, dressed in
// the player's skin parts, clothing and armor, frozen in one frame of an emote (or riding a stone elk), every face reset to one 16 px tile
// of the block's stone or metal. This is a port of that geometry, so a statue can be drawn outside the game (vsdev screenshots, schematics).
//
// KEEP IN SYNC with StatueMod (StatueMesh.cs, StatuePose.cs, StatueAppearance.cs, StatueTypes.cs, StatueTack.cs, StatuePoses.cs,
// StatuePlatform.cs, StatueMolding.cs, BlockEntityStatue.cs and the blocktypes' textures): a change to how the mod draws a statue needs
// the same change here. Both repos' CLAUDE.md say so.
//
// Pure: no fs, no DOM. Shapes and item types come through a `StatueIo` the caller supplies. All geometry is in the shape files' 1/16 block
// units with the origin at the block's corner, like a block's own shape; `ShapeBox`es come out ready for the voxel viewer.
import {
  compactShape, elementFrame, holdInHand, rotationMatrix, shapeToBoxes, transformBoxes,
  type CompactAnimation, type CompactKeyframe, type ElementFrame, type ElementPose, type HandTransform, type ShapeBox,
} from "./shapeBoxes.js";

type Vec = [number, number, number];
type Mat3 = ElementFrame["r"];
type RawElement = Record<string, unknown> & { name?: string; children?: RawElement[]; faces?: Record<string, Record<string, unknown> | null> };
type RawShape = Record<string, unknown> & { elements: RawElement[] };

/** The mod's constants (BlockEntityStatue, StatueMesh, StatueTypes, StatuePlatform, StatueMolding). Scales are of the seraph, about 2 blocks tall. */
export const STATUE = {
  bodyShape: "game:shapes/entity/humanoid/seraph-faceless.json",
  elkShape: "game:shapes/entity/animal/mammal/hooved/deer/elk/female.json",
  elkPartsPath: "game:shapes/entity/animal/mammal/hooved/deer/elk/",
  scale: { small: 0.5, large: 1.75, bust: 1.25, rideSmall: 0.38, rideLarge: 1.3 },
  /** The pedestal slab is 2 px thick; the figure stands on it. */
  pedestalHeight: 2,
  /** The rider sits this far (blocks) below the elk's Rider seat. */
  riderOffsetY: -0.55,
  /** How far a mount's platform sticks out past the feet, px; only the bottom quarter of the mesh counts as feet. */
  platformMargin: 2,
  platformFloorFraction: 0.25,
  /** Fire clay packed around a statue for a mold: pieces for a full mold per size, and its margin around the figure (px). */
  clayNeeded: { bust: 5, small: 8, large: 16 } as Record<string, number>,
  clayMargin: 1.5,
  bustBones: new Set(["Neck", "Head", "UpperTorso", "LowerTorso"]),
  riderLeanBones: new Set(["UpperTorso", "Neck", "Head"]),
  riderEmoteBones: new Set(["UpperArmR", "LowerArmR", "UpperArmL", "LowerArmL", "Neck", "Head"]),
  /** Special statues (StatueTypes.Specials): a fixed shape, front on the south face, its own slab named "Pedestal" left out. */
  specials: { robot: { shape: "nf3tstatue:shapes/block/robot.json", figureHeight: 30.8 / 16 } } as Record<string, { shape: string; figureHeight: number }>,
  /** Tack choices per piece (StatueTack): bridle, face, saddle, bags. */
  tack: [["", "bridle1", "bridle2"], ["", ...Array.from({ length: 16 }, (_, i) => `face${i + 1}`)], ["", "saddle1"], ["", "saddlebags1", "saddlebags2"]],
  maxAntlers: 8,
  defaultAntlers: 4,
} as const;

/** One finished (or blank) statue, as its block entity stores it (StatueAppearance.Write + BlockEntityStatue). Codes are `domain:code`. */
export interface StatueDesign {
  /** The statue block's code, e.g. `nf3tstatue:statue-small-whitemarble` or `nf3tstatue:statuemetal-large-gold`. */
  block: string;
  /** `player` or a special type (`robot`). */
  type: string;
  /** Player pose: an emote code of the seraph shape (`cheer`, `wave`...), `none` (standing), `riding`, or "" for an uncarved block. */
  emote: string;
  /** Frame of the emote; -1 picks the most expressive keyframe. */
  frame: number;
  /** Skin part shapes (hair, beard...), `domain:path` without `shapes/` and `.json`. */
  skinShapes: string[];
  /** Worn items, inner to outer: clothing, then armor. */
  clothing: string[];
  armor: string[];
  rightHand?: string;
  leftHand?: string;
  /** "", `elkcow` or `elkbull`. */
  mount: string;
  /** `stand`, `walk` or `gallop`. */
  elkPose: string;
  /** Frame of the elk's stride; -1 picks the best one. */
  elkFrame: number;
  /** A bull's antlers, 0 (none) to 8. */
  antlers: number;
  /** Bridle, face, saddle, bags; "" for none. */
  tack: [string, string, string, string];
  noPedestal: boolean;
  /** The block entity's turn about Y, radians (`meshAngleY`). */
  angleY: number;
  /** Pieces of fire clay packed around it (a mold in progress). */
  clayLevel: number;
}

/** A design with every field at the mod's default (an uncarved block). */
export function emptyStatueDesign(block: string): StatueDesign {
  return {
    block, type: "player", emote: "", frame: -1, skinShapes: [], clothing: [], armor: [], mount: "", elkPose: "stand", elkFrame: -1,
    antlers: STATUE.defaultAntlers, tack: ["", "", "", ""], noPedestal: false, angleY: 0, clayLevel: 0,
  };
}

/** Whether a block code is a statue block of the mod (stone or metal; not the blank, the mold or other blocks). */
export function isStatueBlock(code: string): boolean {
  return /^nf3tstatue:statue(?:metal)?-(?:small|large|bust)-[a-z0-9]+$/.test(code);
}

/** The size variant (`small`, `large`, `bust`) of a statue block code. */
export function statueSize(block: string): string {
  return /-(small|large|bust)-/.exec(block)?.[1] ?? "small";
}

/**
 * The block's carving texture (`stone` in statue.json / statuemetal.json) and the block code whose block color stands in for it when
 * drawing untextured. The mod's blocktypes map rock to `game:block/stone/rock/{rock}1` and metal to its plain sheet (gold: its plate).
 */
export function statueMaterial(block: string): { texture: string; colorCode: string; metal?: string } {
  const metal = /statuemetal-[a-z]+-([a-z0-9]+)$/.exec(block)?.[1];
  if (metal) {
    const texture = metal === "gold" ? "game:block/metal/plate/gold"
      : ["bismuth", "brass", "molybdochalkos"].includes(metal) ? `game:block/metal/sheet-plain/${metal}3`
      : `game:block/metal/sheet-plain/${metal}1`;
    return { texture, colorCode: `game:metalblock-new-plain-${metal}`, metal };
  }
  const rock = /statue-[a-z]+-([a-z0-9]+)$/.exec(block)?.[1] ?? "granite";
  return { texture: `game:block/stone/rock/${rock}1`, colorCode: `game:rock-${rock}` };
}

/** An item stack as decoded from a block entity (`schematicDecode`): the class and the id that indexes the schematic's code tables. */
interface TreeStack {
  itemClass: "block" | "item";
  id: number;
}
const isStack = (v: unknown): v is TreeStack => !!v && typeof v === "object" && "itemClass" in v && "id" in v;

/**
 * A statue's design from its block entity's attributes (a decoded schematic block entity, or the `nf3tstatue` tree of a statue item).
 * Item stacks are resolved to codes through the schematic's `BlockCodes`/`ItemCodes`; ones that don't resolve are left out, like the mod
 * drops stacks that no longer exist.
 */
export function statueDesignFromTree(
  tree: Record<string, unknown>, block: string, codes: { blockCodes?: Record<string, string>; itemCodes?: Record<string, string> } = {},
): StatueDesign {
  const t = (tree.nf3tstatue && typeof tree.nf3tstatue === "object" ? tree.nf3tstatue : tree) as Record<string, unknown>;
  const str = (k: string, d: string) => (typeof t[k] === "string" ? (t[k] as string) : d);
  const num = (k: string, d: number) => (typeof t[k] === "number" && Number.isFinite(t[k]) ? (t[k] as number) : d);
  const bool = (k: string, d: boolean) => (typeof t[k] === "boolean" ? (t[k] as boolean) : typeof t[k] === "number" ? t[k] !== 0 : d);
  const codeOf = (v: unknown): string | undefined => {
    if (!isStack(v)) return undefined;
    const code = (v.itemClass === "item" ? codes.itemCodes : codes.blockCodes)?.[String(v.id)];
    return code ? (code.includes(":") ? code : `game:${code}`) : undefined;
  };
  const stacks = (key: string) => {
    const out: string[] = [];
    for (let i = 0; i < num(`${key}Count`, 0); i++) {
      const code = codeOf(t[`${key}${i}`]);
      if (code) out.push(code);
    }
    return out;
  };
  const tackParts = str("tack", "").split(";");
  const tack = STATUE.tack.map((choices, i) => ((choices as readonly string[]).includes(tackParts[i] ?? "") ? (tackParts[i] ?? "") : "")) as StatueDesign["tack"];
  const type = str("statueType", "player");
  const skin = str("skinShapes", "");
  return {
    block,
    type: type === "player" || type in STATUE.specials ? type : "player",
    emote: str("emote", ""),
    frame: num("frame", -1),
    skinShapes: skin ? skin.split(";") : [],
    clothing: stacks("clothing"),
    armor: stacks("armor"),
    rightHand: codeOf(t.hands0),
    leftHand: codeOf(t.hands1),
    mount: str("mount", ""),
    elkPose: str("elkPose", "stand"),
    elkFrame: num("elkFrame", -1),
    antlers: Math.min(Math.max(num("antlers", STATUE.defaultAntlers), 0), STATUE.maxAntlers),
    tack,
    noPedestal: bool("noPedestal", false),
    angleY: num("meshAngleY", 0),
    clayLevel: num("clayLevel", 0),
  };
}

/** What the caller knows about an item or block type, for what a statue wears or holds. */
export interface StatueCollectible {
  /** Its own shape, `domain:shapes/....json`; undefined when it has none. */
  shape?: string;
  /** The shape's `rotateX/Y/Z` (degrees), which the game applies when it meshes the item. */
  shapeRotation?: Vec;
  /**
   * How it is worn (`IAttachableToEntity.FromAttributes`: `attributes.attachableToEntity`, or old clothing's `wearableAttachment`); undefined
   * when it can't be worn. `shape` is its `attachedShape` (or the "default" slot's) when it names one, else the item's own.
   */
  worn?: { shape?: string; disable: string[]; keep: string[] };
  /** `tpHandTransform` over the game's default for an item or block; the left hand uses `tpOffHandTransform` when there is one. */
  hand: HandTransform;
  offHand?: HandTransform;
}

export interface StatueIo {
  /** A shape file, parsed, by `domain:shapes/....json`; undefined when not found. `game:` refs are also tried as `survival:` and `creative:`. */
  shape(ref: string): Promise<unknown | undefined>;
  /** An item or block type by code; undefined when unknown. Only needed for worn and held items. */
  collectible?(code: string): Promise<StatueCollectible | undefined>;
}

export interface StatueResult {
  /** The statue (and the block's own pedestal, unless the statue brings its own or has none), px with the block corner at 0. */
  boxes: ShapeBox[];
  /** Texture key -> `domain:path` texture: every face uses `stone` (the block's material) or `clay`. */
  textures: Record<string, string>;
  /** The block code whose block color stands in for the material when drawing without textures. */
  colorCode: string;
  warnings: string[];
}

export interface StatueOptions {
  /** Draw the block's own pedestal (its shape file) when the statue uses it (default true). */
  pedestal?: boolean;
  /** Turn by the design's `angleY` (default true); off for a scene that turns the part itself. */
  rotate?: boolean;
}

const clone = <T>(v: T): T => structuredClone(v);
const DEG = 180 / Math.PI;

/** `game:` is the base game's domain, whose files live in the game, survival and creative folders. */
export function assetRefCandidates(ref: string): string[] {
  const [domain, ...rest] = ref.split(":");
  const rel = rest.join(":");
  return domain === "game" ? ["game", "survival", "creative"].map((d) => `${d}:${rel}`) : [ref];
}

/** `domain:path` (no `shapes/`, no `.json`, as a CompositeShape base) to a shape file ref. */
export function shapeFileRef(base: string, defaultDomain = "game"): string {
  const [domain, rel] = base.includes(":") ? [base.slice(0, base.indexOf(":")), base.slice(base.indexOf(":") + 1)] : [defaultDomain, base];
  return `${domain}:${rel.startsWith("shapes/") ? rel : `shapes/${rel}`}${rel.endsWith(".json") ? "" : ".json"}`;
}

function* walk(elements: RawElement[] | undefined): Generator<RawElement> {
  for (const el of elements ?? []) {
    yield el;
    yield* walk(el.children);
  }
}

const findElement = (elements: RawElement[], name: string): RawElement | undefined => {
  const lower = name.toLowerCase();
  for (const el of walk(elements)) if (typeof el.name === "string" && el.name.toLowerCase() === lower) return el;
  return undefined;
};

/**
 * Hangs a shape's step-parented elements on the named elements of `parent`, as the game's `Shape.StepParentShape` does: elements are
 * matched by name ignoring case, a nested element with a `stepParentName` is lifted out of its own parent, and a top-level element without
 * one (or whose bone is missing) is left out. Returns the names of the missing bones.
 */
export function stepParent(parent: RawShape, child: RawShape): string[] {
  const missing: string[] = [];
  const visit = (owner: RawElement | null, elements: RawElement[]) => {
    for (const el of [...elements]) {
      if (el.children) visit(el, el.children);
      const boneName = typeof el.stepParentName === "string" ? el.stepParentName : undefined;
      if (!boneName) continue;
      const bone = findElement(parent.elements, boneName);
      if (!bone) {
        missing.push(boneName);
        continue;
      }
      if (owner) owner.children = owner.children!.filter((c) => c !== el);
      (bone.children ??= []).push(el);
    }
  };
  visit(null, clone(child.elements));
  return missing;
}

/** `Shape.RemoveElements`: every element with one of these names (or `skinpart-<name>`), any depth, ignoring case. */
export function removeElements(shape: RawShape, names: string[]): void {
  const set = new Set(names.flatMap((n) => [n.toLowerCase(), `skinpart-${n.toLowerCase()}`]));
  const prune = (elements: RawElement[]): RawElement[] =>
    elements.filter((e) => !(typeof e.name === "string" && set.has(e.name.toLowerCase()))).map((e) => (e.children ? { ...e, children: prune(e.children) } : e));
  shape.elements = prune(shape.elements);
}

/**
 * StatuePose.UseSingleTile: each face shows one 16 px tile of the texture, as big as the element's side (1..16 px), so the stone's grain
 * keeps one scale instead of following the skin's UV layout; every face uses `texture`.
 */
export function useSingleTile(shape: RawShape, texture = "stone"): void {
  shape.textureWidth = 16;
  shape.textureHeight = 16;
  delete shape.textureSizes;
  const clamp = (v: number) => Math.min(Math.max(Math.abs(v), 1), 16);
  for (const el of walk(shape.elements)) {
    const from = el.from as Vec | undefined, to = el.to as Vec | undefined;
    if (!el.faces || !from || !to) continue;
    const [sx, sy, sz] = [0, 1, 2].map((i) => clamp(to[i] - from[i]));
    const size: Record<string, [number, number]> = { north: [sx, sy], south: [sx, sy], east: [sz, sy], west: [sz, sy], up: [sx, sz], down: [sx, sz] };
    for (const [side, face] of Object.entries(el.faces)) {
      if (!face || !size[side]) continue;
      face.uv = [0, 0, ...size[side]];
      face.texture = `#${texture}`;
      delete face.rotation;
    }
  }
}

/** Every face of a raw shape retextured to one key, UVs kept (the block's pedestal, which is already drawn in one stone). */
function retexture(shape: RawShape, texture: string): void {
  for (const el of walk(shape.elements)) for (const face of Object.values(el.faces ?? {})) if (face) face.texture = `#${texture}`;
}

/** StatuePose.HideExcept: removes the faces of every element not named in `keep`; the elements stay, so their transforms still apply. */
function hideExcept(shape: RawShape, keep: Set<string>): void {
  for (const el of walk(shape.elements)) if (typeof el.name !== "string" || !keep.has(el.name)) delete el.faces;
}

/** StatuePose.SubtreeNames: the names of the element called `name` and everything under it. */
function subtreeNames(shape: RawShape, name: string): Set<string> {
  const names = new Set<string>();
  const visit = (els: RawElement[] | undefined, inside: boolean) => {
    for (const el of els ?? []) {
      const here = inside || el.name === name;
      if (here && typeof el.name === "string") names.add(el.name);
      visit(el.children, here);
    }
  };
  visit(shape.elements, false);
  return names;
}

const magnitude = (k: CompactKeyframe, bones?: ReadonlySet<string>) => {
  let total = 0;
  for (const [name, p] of Object.entries(k.elements)) {
    if (bones && !bones.has(name)) continue;
    total += Math.abs(p.rx ?? 0) + Math.abs(p.ry ?? 0) + Math.abs(p.rz ?? 0) + 0.1 * (Math.abs(p.ox ?? 0) + Math.abs(p.oy ?? 0) + Math.abs(p.oz ?? 0));
  }
  return total;
};

/** StatuePose.PickPeakKeyFrame: the keyframe (other than frame 0) with the most total rotation, counting only `bones` when given. */
export function peakKeyframe(animation: CompactAnimation, bones?: ReadonlySet<string>): CompactKeyframe | undefined {
  if (!animation.keyframes.length) return undefined;
  const candidates = animation.keyframes.some((k) => k.frame > 0) ? animation.keyframes.filter((k) => k.frame > 0) : animation.keyframes;
  let best = candidates[0];
  for (const k of candidates) if (magnitude(k, bones) > magnitude(best, bones)) best = k;
  return best;
}

/** StatuePose.PeakFrame. */
export const peakFrame = (animation: CompactAnimation, bones?: ReadonlySet<string>) => peakKeyframe(animation, bones)?.frame ?? 0;

/**
 * StatuePose.PoseAt: each element interpolated between its own neighbouring keyframes, holding its first or last value outside them (no
 * wrapping, even for a looping animation).
 */
export function poseAt(animation: CompactAnimation, frame: number): Record<string, ElementPose> {
  const out: Record<string, ElementPose> = {};
  const names = new Set(animation.keyframes.flatMap((k) => Object.keys(k.elements)));
  for (const name of names) {
    const owners = animation.keyframes.filter((k) => k.elements[name]).sort((a, b) => a.frame - b.frame);
    const before = owners.filter((k) => k.frame <= frame).at(-1);
    const after = owners.find((k) => k.frame >= frame);
    const from = (before ?? after)!, to = (after ?? before)!;
    const t = from.frame === to.frame ? 0 : (frame - from.frame) / (to.frame - from.frame);
    const pose: ElementPose = {};
    for (const f of ["ox", "oy", "oz", "rx", "ry", "rz"] as const) {
      const a = from.elements[name][f], b = to.elements[name][f];
      if (a === undefined && b === undefined) continue;
      pose[f] = (a ?? 0) + ((b ?? 0) - (a ?? 0)) * t;
    }
    out[name] = pose;
  }
  return out;
}

/**
 * StatuePose.Apply: bakes a pose into the elements: rotations add to the element's own, and the offset moves its `from`, `to` and
 * `rotationOrigin` (so children, positioned relative to it, follow).
 */
export function applyPose(shape: RawShape, pose: Record<string, ElementPose>): void {
  for (const el of walk(shape.elements)) {
    const p = typeof el.name === "string" ? pose[el.name] : undefined;
    if (!p) continue;
    for (const [axis, key] of [["rotationX", "rx"], ["rotationY", "ry"], ["rotationZ", "rz"]] as const) el[axis] = ((el[axis] as number) ?? 0) + (p[key] ?? 0);
    const d: Vec = [p.ox ?? 0, p.oy ?? 0, p.oz ?? 0];
    for (const k of ["from", "to", "rotationOrigin"]) {
      const v = el[k];
      if (Array.isArray(v) && v.length >= 3) el[k] = [v[0] + d[0], v[1] + d[1], v[2] + d[2]];
    }
  }
}

const animationOf = (raw: RawShape, code: string | undefined): CompactAnimation | undefined =>
  code ? compactShape({ elements: [], animations: raw.animations }).animations?.find((a) => a.code === code) : undefined;

// ---- small affine maths (px): p -> m p + t ----
interface Affine {
  m: Mat3;
  t: Vec;
}
const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul3 = (a: Mat3, b: Mat3): Mat3 => {
  const o = new Array(9) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const ap3 = (m: Mat3, v: Vec): Vec => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const compose = (a: Affine, b: Affine): Affine => {
  const bt = ap3(a.m, b.t);
  return { m: mul3(a.m, b.m), t: [bt[0] + a.t[0], bt[1] + a.t[1], bt[2] + a.t[2]] };
};
const translate = (x: number, y: number, z: number): Affine => ({ m: I3, t: [x, y, z] });
const rotate = (rx: number, ry: number, rz: number): Affine => ({ m: rotationMatrix(rx, ry, rz), t: [0, 0, 0] });
const moveBoxes = (boxes: ShapeBox[], a: Affine): ShapeBox[] => transformBoxes(boxes, a.m, a.t);
/** Uniform scale about `c`. */
const scaleAbout = (boxes: ShapeBox[], c: Vec, s: number) => transformBoxes(boxes, I3, [c[0] * (1 - s), c[1] * (1 - s), c[2] * (1 - s)], s);

const quatToMat = ([x, y, z, w]: [number, number, number, number]): Mat3 => [
  1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
  2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
  2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
];

/** Every box corner (the mesh's vertices, which the mod measures). */
export function boxCorners(boxes: ShapeBox[]): Vec[] {
  const out: Vec[] = [];
  for (const b of boxes) {
    const r = b.quaternion ? quatToMat(b.quaternion) : I3;
    for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
      const v = ap3(r, [dx * b.sx, dy * b.sy, dz * b.sz]);
      out.push([b.x + v[0], b.y + v[1], b.z + v[2]]);
    }
  }
  return out;
}

const boundsOf = (points: Vec[]) => {
  const lo: Vec = [Infinity, Infinity, Infinity], hi: Vec = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) (lo[i] = Math.min(lo[i], p[i])), (hi[i] = Math.max(hi[i], p[i]));
  return { lo, hi };
};

/** StatuePlatform.Footprint: x/z extent of the vertices in the bottom `fraction` of the mesh (its feet), px. */
export function footprint(points: Vec[], fraction: number = STATUE.platformFloorFraction): { minX: number; maxX: number; minZ: number; maxZ: number } | undefined {
  if (!points.length) return undefined;
  const { lo, hi } = boundsOf(points);
  const limit = lo[1] + (hi[1] - lo[1]) * fraction;
  const feet = points.filter((p) => p[1] <= limit);
  const b = boundsOf(feet);
  return { minX: b.lo[0], maxX: b.hi[0], minZ: b.lo[2], maxZ: b.hi[2] };
}

/** A single-tile box (the mod's platform and clay), px. */
function slab(from: Vec, to: Vec, texture: string): ShapeBox[] {
  const face = { texture: `#${texture}` };
  const raw: RawShape = { elements: [{ name: texture, from, to, faces: { north: { ...face }, east: { ...face }, south: { ...face }, west: { ...face }, up: { ...face }, down: { ...face } } }] };
  useSingleTile(raw, texture);
  return shapeToBoxes(compactShape(raw, { faces: true }));
}

/** An attachment point of an element: position px, rotation degrees (the file's values are often strings). */
function attachmentPoint(shape: RawShape, element: string, code: string): { pos: Vec; rot: Vec } | undefined {
  const el = findElement(shape.elements, element);
  const ap = (Array.isArray(el?.attachmentpoints) ? el.attachmentpoints : []).find((p: Record<string, unknown>) => p?.code === code) as Record<string, unknown> | undefined;
  if (!ap) return undefined;
  const n = (k: string) => Number(ap[k] ?? 0) || 0;
  return { pos: [n("posX"), n("posY"), n("posZ")], rot: [n("rotationX"), n("rotationY"), n("rotationZ")] };
}

/**
 * The boxes of a statue block, the way StatueMesh.Build and BlockEntityStatue.OnTesselation draw it. An uncarved block is only its
 * pedestal. Missing shapes or item types become warnings, never errors.
 */
export async function buildStatue(design: StatueDesign, io: StatueIo, options: StatueOptions = {}): Promise<StatueResult> {
  const warnings: string[] = [];
  const material = statueMaterial(design.block);
  const result: StatueResult = { boxes: [], textures: { stone: material.texture }, colorCode: material.colorCode, warnings };
  const size = statueSize(design.block);
  const bust = size === "bust";
  const cache = new Map<string, Promise<RawShape | undefined>>();
  const load = (ref: string): Promise<RawShape | undefined> => {
    let p = cache.get(ref);
    if (!p) {
      p = (async () => {
        for (const candidate of assetRefCandidates(ref)) {
          const raw = await io.shape(candidate);
          if (raw && typeof raw === "object" && Array.isArray((raw as RawShape).elements)) return raw as RawShape;
        }
        warnings.push(`shape ${ref} not found`);
        return undefined;
      })();
      cache.set(ref, p);
    }
    return p.then((s) => (s ? clone(s) : undefined));
  };
  const collectible = async (code: string) => {
    const c = io.collectible ? await io.collectible(code) : undefined;
    if (!c) warnings.push(`no item or block type ${code}`);
    return c;
  };

  const configured = design.emote !== "" || design.type !== "player";
  const riding = !bust && design.mount !== "";
  let figure: ShapeBox[] = [];
  if (configured) {
    const special = STATUE.specials[design.type];
    figure = special ? await buildSpecial(special, size, design, load) : await buildPlayer(design, bust, riding, size, load, collectible, warnings);
  }

  // OnTesselation: a rider brings its own platform, and noPedestal has none; otherwise the block's own shape is the pedestal.
  const usesBlockShape = !figure.length || !(riding || design.noPedestal);
  let pedestal: ShapeBox[] = [];
  if (usesBlockShape && options.pedestal !== false) {
    const shape = await load(`nf3tstatue:shapes/block/${size === "large" ? "pedestal-large" : "pedestal"}.json`);
    if (shape) {
      retexture(shape, "stone");
      pedestal = shapeToBoxes(compactShape(shape, { faces: true }));
    }
  }

  if (figure.length && design.clayLevel > 0) {
    // ClayFill: a block of fire clay around the finished mesh, rising with every piece.
    const { lo, hi } = boundsOf(boxCorners(figure));
    const m = STATUE.clayMargin;
    const fraction = Math.min(Math.max(design.clayLevel / (STATUE.clayNeeded[size] ?? 8), 0), 1);
    const top = lo[1] + (hi[1] - lo[1] + m) * fraction;
    figure.push(...slab([lo[0] - m, lo[1], lo[2] - m], [hi[0] + m, Math.max(top, lo[1] + 1), hi[2] + m], "clay"));
    result.textures.clay = "game:block/clay/fireclay";
  }

  // The figure is already turned by angleY (the mod turns its mesh); the block's own pedestal is square and isn't.
  result.boxes = [...pedestal, ...figure];
  return result;

  // ---- the parts ----
  async function buildSpecial(special: { shape: string; figureHeight: number }, size: string, d: StatueDesign, loadShape: typeof load): Promise<ShapeBox[]> {
    const shape = await loadShape(special.shape);
    if (!shape) return [];
    shape.elements = shape.elements.filter((e) => e.name !== "Pedestal");
    useSingleTile(shape);
    let boxes = shapeToBoxes(compactShape(shape, { faces: true }));
    boxes = moveBoxes(boxes, translate(0, -STATUE.pedestalHeight, 0));
    const scale = (size === "large" ? 3.75 : 0.875) / special.figureHeight;
    boxes = scaleAbout(boxes, [8, 0, 8], scale);
    if (!d.noPedestal) boxes = moveBoxes(boxes, translate(0, STATUE.pedestalHeight, 0));
    // The shape's front is south; a statue facing west at angle 0 is turned a quarter back from that.
    return turn(boxes, d.angleY - Math.PI / 2);
  }

  function turn(boxes: ShapeBox[], angle: number): ShapeBox[] {
    if (options.rotate === false || !angle) return boxes;
    const r = rotationMatrix(0, angle * DEG, 0);
    const rc = ap3(r, [8, 0, 8]);
    return transformBoxes(boxes, r, [8 - rc[0], 0 - rc[1], 8 - rc[2]]);
  }

  async function buildPlayer(
    d: StatueDesign, bust: boolean, riding: boolean, size: string, loadShape: typeof load,
    lookup: (code: string) => Promise<StatueCollectible | undefined>, warn: string[],
  ): Promise<ShapeBox[]> {
    const seraph = await loadShape(STATUE.bodyShape);
    if (!seraph) return [];
    const animations = compactShape({ elements: [], animations: seraph.animations }).animations ?? [];
    const anim = (code: string) => animations.find((a) => a.code === code);
    const body: RawShape = { ...seraph, animations: [] };

    for (const skin of d.skinShapes) {
      const part = await loadShape(shapeFileRef(skin));
      if (part) for (const bone of stepParent(body, part)) warn.push(`skin part ${skin}: no bone ${bone}`);
    }
    for (const code of [...d.clothing, ...d.armor]) {
      const c = await lookup(code);
      if (!c?.worn) continue; // only recolors the skin, or can't be worn: nothing to carve
      const ref = c.worn.shape ?? c.shape;
      const part = ref ? await loadShape(ref) : undefined;
      if (!part) continue;
      const keep = new Set(c.worn.keep.map((k) => k.toLowerCase()));
      removeElements(body, c.worn.disable.filter((n) => !keep.has(n.toLowerCase())));
      for (const bone of stepParent(body, part)) warn.push(`${code}: no bone ${bone}`);
    }

    // The pose.
    const elkGait = d.elkPose === "walk" ? "walk" : d.elkPose === "gallop" ? "run" : undefined;
    const riderAnimation = (pose: string) => (pose === "walk" ? "rideelk-walk" : pose === "gallop" ? "rideelk-run" : "rideelk-idle");
    let elkRaw: RawShape | undefined;
    if (riding) {
      elkRaw = await loadShape(STATUE.elkShape);
      const gait = elkRaw && elkGait ? animationOf(elkRaw, elkGait) : undefined;
      const ride = anim(riderAnimation(d.elkPose));
      const gaitFrame = d.elkFrame < 0
        ? (gait && ride ? peakFrame(ride, STATUE.riderLeanBones) : 0)
        : Math.min(Math.max(d.elkFrame, 0), Math.max(0, (gait?.frames ?? 1) - 1));
      const isRiding = d.emote === "riding";
      const seatAnim = anim(isRiding ? riderAnimation(d.elkPose) : riderAnimation("stand"));
      if (seatAnim) {
        let seated = poseAt(seatAnim, isRiding ? Math.min(Math.max(gaitFrame, 0), seatAnim.frames - 1) : 0);
        const emote = !isRiding ? anim(d.emote) : undefined;
        if (emote) {
          const key = d.frame < 0 ? peakKeyframe(emote)?.elements : poseAt(emote, d.frame);
          if (key) {
            seated = { ...seated };
            for (const [name, p] of Object.entries(key)) if (STATUE.riderEmoteBones.has(name)) seated[name] = p;
          }
        }
        applyPose(body, seated);
      }
    } else {
      const emote = anim(d.emote);
      if (emote) {
        const key = d.frame < 0 ? peakKeyframe(emote, bust ? STATUE.bustBones : undefined)?.elements : poseAt(emote, d.frame);
        if (key) applyPose(body, key);
      }
    }

    if (bust) hideExcept(body, subtreeNames(body, "Neck"));
    useSingleTile(body);
    const bodyShape = compactShape(body, { faces: true });
    let mesh = shapeToBoxes(bodyShape);

    if (!bust) {
      for (const [code, anchor, point] of [[d.rightHand, "ItemAnchor", "RightHand"], [d.leftHand, "ItemAnchorL", "LeftHand"]] as const) {
        if (!code) continue;
        const c = await lookup(code);
        const frame = elementFrame(bodyShape, anchor);
        const item = c?.shape ? await loadShape(c.shape) : undefined;
        if (!c || !item || !frame) {
          if (c) warn.push(`cannot hold ${code}: ${!frame ? `no ${anchor}` : `shape ${c.shape ?? "(none)"} missing`}`);
          continue;
        }
        useSingleTile(item);
        let itemBoxes = shapeToBoxes(compactShape(item, { faces: true }));
        const [rx, ry, rz] = c.shapeRotation ?? [0, 0, 0];
        if (rx || ry || rz) {
          const r = rotationMatrix(rx, ry, rz);
          const rc = ap3(r, [8, 8, 8]);
          itemBoxes = transformBoxes(itemBoxes, r, [8 - rc[0], 8 - rc[1], 8 - rc[2]]);
        }
        const hand = (point === "LeftHand" ? c.offHand : undefined) ?? c.hand;
        mesh.push(...holdInHand(itemBoxes, frame, attachmentPoint(body, anchor, point) ?? { pos: [0, 0, 0], rot: [0, 0, 0] }, hand));
      }
    }

    if (riding && elkRaw) mesh = await seatOnElk(d, elkRaw, mesh, loadShape, warn);

    if (bust || riding) {
      // CenterOnPedestal: the head sits high on the body, a mount far from the origin.
      const { lo, hi } = boundsOf(boxCorners(mesh));
      mesh = moveBoxes(mesh, translate(8 - (lo[0] + hi[0]) / 2, -lo[1], 8 - (lo[2] + hi[2]) / 2));
    }
    const scale = size === "large" ? (riding ? STATUE.scale.rideLarge : STATUE.scale.large) : bust ? STATUE.scale.bust : riding ? STATUE.scale.rideSmall : STATUE.scale.small;
    mesh = scaleAbout(mesh, [8, 0, 8], scale);
    if (!d.noPedestal) mesh = moveBoxes(mesh, translate(0, STATUE.pedestalHeight, 0));
    if (riding && !d.noPedestal) {
      const feet = footprint(boxCorners(mesh));
      const m = STATUE.platformMargin;
      if (feet) mesh.push(...slab([feet.minX - m, 0, feet.minZ - m], [feet.maxX + m, STATUE.pedestalHeight, feet.maxZ + m], "stone"));
    }
    return turn(mesh, d.angleY);
  }

  async function seatOnElk(d: StatueDesign, elkRaw: RawShape, rider: ShapeBox[], loadShape: typeof load, warn: string[]): Promise<ShapeBox[]> {
    const elk: RawShape = { ...elkRaw, animations: [] };
    const bull = d.mount === "elkbull";
    const antlers = bull ? d.antlers : 0;
    const addPart = async (ref: string) => {
      const part = await loadShape(ref);
      if (part) for (const bone of stepParent(elk, part)) warn.push(`${ref}: no bone ${bone} on the elk`);
    };
    if (bull) {
      await addPart(`${STATUE.elkPartsPath}malefringe.json`);
      if (antlers > 0) await addPart(`${STATUE.elkPartsPath}antlers0${antlers}.json`);
    }
    for (let i = 0; i < 4; i++) {
      const type = d.tack[i];
      if (type) await addPart(i === 1 ? `game:shapes/item/wearable/hooved/face/${type}-elk.json` : `game:shapes/item/wearable/hooved/${type}-elk.json`);
    }
    // PoseElk. The mod passes the player's frame here (StatueMesh.Build -> SeatOnElk(..., frame)), not the elk frame; kept as the mod does it.
    const gait = d.elkPose === "walk" ? "walk" : d.elkPose === "gallop" ? "run" : undefined;
    if (gait) {
      const animation = (antlers > 0 ? animationOf(elkRaw, `${gait}-antlers`) : undefined) ?? animationOf(elkRaw, gait);
      if (animation) applyPose(elk, poseAt(animation, d.frame < 0 ? peakFrame(animation) : Math.min(Math.max(d.frame, 0), animation.frames - 1)));
    }
    useSingleTile(elk);
    const elkShape = compactShape(elk, { faces: true });
    const elkBoxes = shapeToBoxes(elkShape);
    const mid = elementFrame(elkShape, "Midsection");
    const point = attachmentPoint(elk, "Midsection", "Rider");
    if (!mid || !point) {
      warn.push("the elk shape has no Rider seat");
      return rider;
    }
    // AnchorMatrix: the posed element, then the point's offset, turned about the middle of a unit block; then the rider offset.
    let seat: Affine = { m: mid.r, t: mid.t };
    seat = compose(seat, translate(...point.pos));
    seat = compose(seat, translate(-8, -8, -8));
    seat = compose(seat, rotate(...point.rot));
    seat = compose(seat, translate(8, 8, 8));
    seat = compose(seat, translate(0, STATUE.riderOffsetY * 16, 0));
    seat = compose(seat, translate(-8, 0, -8));
    return [...elkBoxes, ...moveBoxes(rider, seat)];
  }
}
