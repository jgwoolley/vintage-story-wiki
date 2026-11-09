// Vintage Story shape files (`shapes/item/**`, `shapes/entity/**`) as boxes for the voxel viewer.
// A shape is a tree of cuboids on a 16-units-per-block grid; each element may rotate about its own
// `rotationOrigin`, and its children are positioned relative to it (see shapeToBoxes). This module only does the geometry (no Three.js, no DOM, so
// Node tests can import it): `compactShape` trims a raw shape file to what is drawn (ingest writes that), `shapeToBoxes`
// flattens the tree into world-space boxes. Untextured by default: each box only remembers which texture key its
// faces use, so the page can give every key its own stable color. `compactShape(raw, { faces: true })` also keeps each face's
// texture key, UV and rotation, for callers that have the game's texture images (a local install); the wiki's ingest doesn't.
// Animations are kept as keyframes (`CompactAnimation`) and applied by passing a sampled pose to `shapeToBoxes`; without one it is the rest pose.

/** The six faces of an element, in the order the game lists them. */
export type FaceSide = "north" | "east" | "south" | "west" | "up" | "down";

/** One face of an element, kept only by `compactShape(raw, { faces: true })`. */
export interface ShapeFace {
  /** Texture key without "#". */
  texture: string;
  /** [u1, v1, u2, v2] in the shape's texture units (`textureWidth`/`textureHeight`, or that key's `textureSizes` entry); u2 < u1 mirrors. */
  uv: [number, number, number, number];
  /** Clockwise rotation of the texture on the face, in degrees (0, 90, 180, 270). */
  rotation?: number;
}

/** One element of a compacted shape: faces and UVs are gone (unless asked for), the texture key it uses is kept. */
export interface ShapeElement {
  from: [number, number, number];
  to: [number, number, number];
  /** Pivot of this element's rotation, in the same absolute shape space as `from`/`to` (default 0,0,0). */
  rotationOrigin?: [number, number, number];
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  /** The element's own name; only used to find it as a `stepParent`. */
  name?: string;
  /** Name of the element of another shape (the player body) this element is attached to; see `attachToBase`. */
  stepParent?: string;
  /** Texture key of the element's first textured face, without the leading "#" (e.g. "metal"). */
  texture?: string;
  /** Every enabled, textured face; only with `compactShape(raw, { faces: true })`. */
  faces?: Partial<Record<FaceSide, ShapeFace>>;
  children?: ShapeElement[];
}

/** How an animation moves one element at one moment, added to the element's own placement: rotations in degrees, offsets in the shape's 1/16-block units. Missing values are 0. */
export interface ElementPose {
  ox?: number;
  oy?: number;
  oz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

export interface CompactKeyframe {
  frame: number;
  /** Element name -> its pose at this frame; an element is only listed in the keyframes where the animation moves it. */
  elements: Record<string, ElementPose>;
}

/** One animation of a shape (`walk`, `idle`...), at the game's 30 frames per second. */
export interface CompactAnimation {
  code: string;
  name?: string;
  /** Length in frames (`quantityframes`). */
  frames: number;
  /** `onAnimationEnd: "Repeat"`: wraps from the last keyframe back to the first; otherwise it holds its last pose. */
  loop: boolean;
  keyframes: CompactKeyframe[];
}

export interface CompactShape {
  elements: ShapeElement[];
  animations?: CompactAnimation[];
  /** `textureWidth`/`textureHeight` (the units face UVs are in; default 16x16); only with faces. */
  textureSize?: [number, number];
  /** Per texture key overrides of `textureSize` (the file's `textureSizes`); only with faces. */
  textureSizes?: Record<string, [number, number]>;
}

/** A box face for a textured viewer: UVs normalized to 0..1 of the texture image, v down from the image's top as in the file. */
export interface BoxFace {
  side: FaceSide;
  texture: string;
  uv: [number, number, number, number];
  rotation?: number;
}

/** A box ready for `createVoxelViewer` (centers and sizes in 1/16 block units), with an optional rotation about its own center. */
export interface ShapeBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  /** Rotation (x, y, z, w) about the box center; absent for an axis-aligned box. */
  quaternion?: [number, number, number, number];
  texture?: string;
  /** The element's faces, when the shape was compacted with faces. */
  faces?: BoxFace[];
}

type Vec = [number, number, number];
/** Row-major 3x3 rotation matrix. */
type Mat3 = [number, number, number, number, number, number, number, number, number];

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** Thickness, in 1/16 block units, given to a zero-thickness element. */
const MIN_THICKNESS = 0.1;
const FACE_ORDER = ["north", "east", "south", "west", "up", "down"];

const isVec = (v: unknown): v is Vec => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const POSE_FIELDS: [keyof ElementPose, string][] = [["ox", "offsetX"], ["oy", "offsetY"], ["oz", "offsetZ"], ["rx", "rotationX"], ["ry", "rotationY"], ["rz", "rotationZ"]];

/** Trims a shape file's `animations` to what `samplePose` needs: numbers rounded, zeros dropped, unknown fields ignored. Animations of the newer matrix `version` are skipped. */
function compactAnimations(raw: unknown): CompactAnimation[] {
  if (!Array.isArray(raw)) return [];
  const out: CompactAnimation[] = [];
  for (const a of raw as Record<string, unknown>[]) {
    if (!a || typeof a.code !== "string" || typeof a.quantityframes !== "number" || !Array.isArray(a.keyframes) || (a.version ?? 0) !== 0) continue;
    const keyframes: CompactKeyframe[] = [];
    for (const k of a.keyframes as Record<string, unknown>[]) {
      if (typeof k?.frame !== "number" || !k.elements || typeof k.elements !== "object") continue;
      const elements: Record<string, ElementPose> = {};
      for (const [name, value] of Object.entries(k.elements as Record<string, Record<string, unknown>>)) {
        const pose: ElementPose = {};
        for (const [short, long] of POSE_FIELDS) {
          const n = value?.[long];
          if (typeof n === "number" && round(n) !== 0) pose[short] = round(n);
        }
        elements[name] = pose;
      }
      keyframes.push({ frame: k.frame, elements });
    }
    if (!keyframes.length) continue;
    keyframes.sort((x, y) => x.frame - y.frame);
    out.push({ code: a.code, ...(typeof a.name === "string" && a.name !== a.code ? { name: a.name } : {}), frames: a.quantityframes, loop: a.onAnimationEnd === "Repeat", keyframes });
  }
  return out;
}

/** The game's animation speed: frames per second. */
export const ANIMATION_FPS = 30;

const tracks = new WeakMap<CompactAnimation, Map<string, { frame: number; pose: ElementPose }[]>>();

/** Every element's own keyframes of an animation, in frame order. */
function tracksOf(animation: CompactAnimation): Map<string, { frame: number; pose: ElementPose }[]> {
  let map = tracks.get(animation);
  if (!map) {
    map = new Map();
    for (const k of animation.keyframes) for (const [name, pose] of Object.entries(k.elements)) (map.get(name) ?? map.set(name, []).get(name)!).push({ frame: k.frame, pose });
    tracks.set(animation, map);
  }
  return map;
}

/**
 * The pose of every animated element at `frame` (any real number; a looping animation wraps, others hold their last pose): each element is
 * interpolated linearly between the keyframes that name it, wrapping from its last keyframe round to its first when the animation loops.
 */
export function samplePose(animation: CompactAnimation, frame: number): Record<string, ElementPose> {
  const t = animation.loop && animation.frames > 0 ? ((frame % animation.frames) + animation.frames) % animation.frames : Math.min(Math.max(frame, 0), animation.frames);
  const out: Record<string, ElementPose> = {};
  for (const [name, keys] of tracksOf(animation)) {
    let before = keys[0], after = keys[0], beforeFrame = keys[0].frame, afterFrame = keys[0].frame;
    if (keys.length > 1) {
      const next = keys.findIndex((k) => k.frame > t);
      if (next === -1) {
        before = keys[keys.length - 1];
        beforeFrame = before.frame;
        after = animation.loop ? keys[0] : before;
        afterFrame = animation.loop ? keys[0].frame + animation.frames : beforeFrame;
      } else if (next === 0) {
        after = keys[0];
        afterFrame = after.frame;
        before = animation.loop ? keys[keys.length - 1] : after;
        beforeFrame = animation.loop ? before.frame - animation.frames : afterFrame;
      } else {
        before = keys[next - 1];
        after = keys[next];
        beforeFrame = before.frame;
        afterFrame = after.frame;
      }
    }
    const span = afterFrame - beforeFrame;
    const f = span > 0 ? (t - beforeFrame) / span : 0;
    const pose: ElementPose = {};
    for (const [field] of POSE_FIELDS) {
      const a = before.pose[field] ?? 0, b = after.pose[field] ?? 0;
      const v = a + (b - a) * f;
      if (v !== 0) pose[field] = v;
    }
    out[name] = pose;
  }
  return out;
}

/** Whether parsed JSON is a model (shape) file -- an `elements` tree of boxes -- rather than a schematic, which has `Indices`/`BlockIds` instead. */
export function looksLikeShape(parsed: unknown): boolean {
  const p = parsed as { elements?: unknown; Indices?: unknown } | null;
  return !!p && typeof p === "object" && !p.Indices && Array.isArray(p.elements) && p.elements.some((e) => e && typeof e === "object" && "from" in e && "to" in e);
}

/**
 * Trims a raw shape file (as parsed from JSON) to a `CompactShape`: drops faces, UVs and everything else
 * that isn't geometry or animation. Elements with a malformed `from`/`to` are dropped (with their children), and a face-less
 * element (the game's "empty" bone-like groups) is kept so its rotation still reaches its children.
 * With `faces: true` it also keeps every face's texture key, UV and rotation and the shape's texture sizes, for drawing real textures.
 */
export function compactShape(raw: unknown, options: { faces?: boolean } = {}): CompactShape {
  const keepFaces = options.faces === true;
  const compactFaces = (el: Record<string, unknown>): ShapeElement["faces"] => {
    const faces = el.faces as Record<string, Record<string, unknown> | undefined> | undefined;
    if (!faces || typeof faces !== "object") return undefined;
    const out: NonNullable<ShapeElement["faces"]> = {};
    const span = [0, 1, 2].map((i) => Math.abs((el.to as Vec)[i] - (el.from as Vec)[i]));
    for (const side of FACE_ORDER as FaceSide[]) {
      const face = faces[side];
      if (!face || face.enabled === false || typeof face.texture !== "string") continue;
      const uv = face.uv;
      // A face without a uv gets the face's own size from the texture's corner, like an unedited face in the model editor.
      const [w, h] = side === "up" || side === "down" ? [span[0], span[2]] : side === "east" || side === "west" ? [span[2], span[1]] : [span[0], span[1]];
      const box: ShapeFace = {
        texture: face.texture.replace(/^#/, ""),
        uv: Array.isArray(uv) && uv.length === 4 && uv.every((n) => typeof n === "number" && Number.isFinite(n)) ? (uv as ShapeFace["uv"]) : [0, 0, w, h],
      };
      if (typeof face.rotation === "number" && face.rotation % 360 !== 0) box.rotation = ((face.rotation % 360) + 360) % 360;
      out[side] = box;
    }
    return Object.keys(out).length ? out : undefined;
  };
  const compactElement = (e: unknown): ShapeElement | undefined => {
    const el = e as Record<string, unknown> | null;
    if (!el || !isVec(el.from) || !isVec(el.to)) return undefined;
    const out: ShapeElement = { from: el.from, to: el.to };
    if (typeof el.name === "string" && el.name) out.name = el.name;
    if (isVec(el.rotationOrigin) && el.rotationOrigin.some((n) => n !== 0)) out.rotationOrigin = el.rotationOrigin;
    for (const axis of ["rotationX", "rotationY", "rotationZ"] as const) {
      const angle = el[axis];
      if (typeof angle === "number" && angle !== 0) out[axis] = angle;
    }
    if (typeof el.stepParentName === "string" && el.stepParentName) out.stepParent = el.stepParentName;
    const faces = el.faces as Record<string, { texture?: unknown; enabled?: unknown }> | undefined;
    if (faces && typeof faces === "object") {
      for (const side of FACE_ORDER) {
        const face = faces[side];
        if (face && face.enabled !== false && typeof face.texture === "string") {
          out.texture = face.texture.replace(/^#/, "");
          break;
        }
      }
    }
    if (keepFaces) {
      const kept = compactFaces(el);
      if (kept) out.faces = kept;
    }
    if (Array.isArray(el.children)) {
      const children = el.children.map(compactElement).filter((c): c is ShapeElement => !!c);
      if (children.length) out.children = children;
    }
    return out;
  };
  const elements = (raw as { elements?: unknown } | null)?.elements;
  const compact: CompactShape = { elements: Array.isArray(elements) ? elements.map(compactElement).filter((e): e is ShapeElement => !!e) : [] };
  const animations = compactAnimations((raw as { animations?: unknown } | null)?.animations);
  if (animations.length) compact.animations = animations;
  if (keepFaces) {
    const file = raw as { textureWidth?: unknown; textureHeight?: unknown; textureSizes?: unknown } | null;
    const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
    compact.textureSize = [positive(file?.textureWidth) ? file.textureWidth : 16, positive(file?.textureHeight) ? file.textureHeight : 16];
    if (file?.textureSizes && typeof file.textureSizes === "object") {
      const sizes: Record<string, [number, number]> = {};
      for (const [key, size] of Object.entries(file.textureSizes as Record<string, unknown>)) {
        if (Array.isArray(size) && size.length === 2 && positive(size[0]) && positive(size[1])) sizes[key] = [size[0], size[1]];
      }
      if (Object.keys(sizes).length) compact.textureSizes = sizes;
    }
  }
  return compact;
}

/**
 * Worn items (armor, clothes) are shapes whose top-level elements name a `stepParentName`: a bone of the player body they hang on
 * (`UpperTorso`, `UpperArmR`...). On their own they have no place to be, so they would all pile up at the origin. This hangs each such
 * element under the named element of `base` (the body shape) as a child, which is what the game does when it dresses the model, and strips
 * the body's own textures so only the worn pieces draw while the body still supplies every pivot and pose. Elements whose parent isn't
 * found stay top-level. A shape with no `stepParent` elements is returned unchanged.
 */
export function attachToBase(shape: CompactShape, base: CompactShape): CompactShape {
  if (!shape.elements.some((e) => e.stepParent)) return shape;
  const hidden = (el: ShapeElement): ShapeElement => {
    const { texture: _texture, faces: _faces, ...rest } = el;
    return { ...rest, ...(el.children ? { children: el.children.map(hidden) } : {}) };
  };
  const body = base.elements.map(hidden);
  const find = (els: ShapeElement[], name: string): ShapeElement | undefined => {
    for (const el of els) {
      if (el.name === name) return el;
      const inChild = el.children && find(el.children, name);
      if (inChild) return inChild;
    }
    return undefined;
  };
  const loose: ShapeElement[] = [];
  for (const el of shape.elements) {
    const parent = el.stepParent ? find(body, el.stepParent) : undefined;
    if (parent) (parent.children ??= []).push(el);
    else loose.push(el);
  }
  // The worn item's texture sizes stay: only its own faces are drawn.
  const { animations: _animations, elements: _elements, ...textureFields } = shape;
  return { ...textureFields, elements: [...body, ...loose] };
}

/** An element's faces with UVs divided by the texture's size (its `textureSizes` entry, else the shape's), so 0..1 spans the image. */
function boxFaces(faces: NonNullable<ShapeElement["faces"]>, shape: CompactShape): BoxFace[] {
  const out: BoxFace[] = [];
  for (const side of FACE_ORDER as FaceSide[]) {
    const face = faces[side];
    if (!face) continue;
    const [w, h] = shape.textureSizes?.[face.texture] ?? shape.textureSize ?? [16, 16];
    const [u1, v1, u2, v2] = face.uv;
    out.push({ side, texture: face.texture, uv: [u1 / w, v1 / h, u2 / w, v2 / h], ...(face.rotation ? { rotation: face.rotation } : {}) });
  }
  return out;
}

function rotation(rx: number, ry: number, rz: number): Mat3 {
  const [ax, ay, az] = [rx, ry, rz].map((d) => (d * Math.PI) / 180);
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  const X: Mat3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Y: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Z: Mat3 = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul(mul(X, Y), Z); // the game applies X, then Y, then Z to the matrix: M = Rx * Ry * Rz
}

function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
}

function apply(m: Mat3, v: Vec): Vec {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

function isIdentity(m: Mat3): boolean {
  return m.every((n, i) => Math.abs(n - IDENTITY[i]) < 1e-9);
}

/** Unit quaternion (x, y, z, w) of a rotation matrix. */
function toQuaternion(m: Mat3): [number, number, number, number] {
  const trace = m[0] + m[4] + m[8];
  let q: [number, number, number, number];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4];
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    q = [s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s];
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    q = [(m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s, (m[2] - m[6]) / s];
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4, (m[3] - m[1]) / s];
  }
  return q;
}

/**
 * Flattens a shape's element tree into boxes, following the game's `ShapeElement.GetLocalTransformMatrix`: an element's
 * matrix is `parent * translate(origin) * Rx * Ry * Rz * translate(from - origin)`, and its box is drawn from 0 to
 * `to - from` in that frame. So a child's `from` and `rotationOrigin` are relative to its parent's `from` (not absolute
 * shape coordinates), and it inherits the parent's rotation. Tracked here as a rotation plus an offset.
 */
export function shapeToBoxes(shape: CompactShape, pose?: Record<string, ElementPose>): ShapeBox[] {
  const boxes: ShapeBox[] = [];
  walkShape(shape, pose, (el, r, t) => {
    const span: Vec = [el.to[0] - el.from[0], el.to[1] - el.from[1], el.to[2] - el.from[2]];
    // Flat planes (zero thickness on one axis: cloth, leaves, fins) get a sliver so they are visible.
    const size = span.map((n) => (n === 0 ? MIN_THICKNESS : n)) as Vec;
    // Elements that name no texture are pure groups (a pivot for their children): nothing to draw.
    if (el.texture !== undefined && size.every((n) => n > 0)) {
      const center = apply(r, [size[0] / 2, size[1] / 2, size[2] / 2]);
      boxes.push({
        x: center[0] + t[0], y: center[1] + t[1], z: center[2] + t[2],
        sx: size[0], sy: size[1], sz: size[2],
        ...(isIdentity(r) ? {} : { quaternion: toQuaternion(r) }),
        texture: el.texture,
        ...(el.faces ? { faces: boxFaces(el.faces, shape) } : {}),
      });
    }
  });
  return boxes;
}

/** An element's frame in the shape's space, in 1/16 block units: `t` is where its `from` corner is, `r` (row-major 3x3) its rotation. */
export interface ElementFrame {
  r: [number, number, number, number, number, number, number, number, number];
  t: [number, number, number];
}

/** The frame of the first element called `name` (e.g. the player body's `ItemAnchor`, where a held item attaches), posed like shapeToBoxes; undefined when there is none. */
export function elementFrame(shape: CompactShape, name: string, pose?: Record<string, ElementPose>): ElementFrame | undefined {
  let found: ElementFrame | undefined;
  walkShape(shape, pose, (el, r, t) => {
    if (!found && el.name === name) found = { r, t };
  });
  return found;
}

/** Visits every element with its frame, following the game's `ShapeElement.GetLocalTransformMatrix` (see shapeToBoxes). */
function walkShape(shape: CompactShape, pose: Record<string, ElementPose> | undefined, visitor: (el: ShapeElement, r: Mat3, t: Vec) => void): void {
  const visit = (el: ShapeElement, parentR: Mat3, parentT: Vec): void => {
    const origin = el.rotationOrigin ?? [0, 0, 0];
    // An animation adds to the element's own rotation and moves it inside its rotated frame (the game's GetLocalTransformMatrix, version 0).
    const p = (el.name && pose?.[el.name]) || undefined;
    const local = rotation((el.rotationX ?? 0) + (p?.rx ?? 0), (el.rotationY ?? 0) + (p?.ry ?? 0), (el.rotationZ ?? 0) + (p?.rz ?? 0));
    // translate(origin) * R * translate(from - origin) maps a point p of the element's own frame to R*p + (origin + R*(from - origin)).
    const shift = apply(local, [el.from[0] + (p?.ox ?? 0) - origin[0], el.from[1] + (p?.oy ?? 0) - origin[1], el.from[2] + (p?.oz ?? 0) - origin[2]]);
    const localT: Vec = [origin[0] + shift[0], origin[1] + shift[1], origin[2] + shift[2]];
    const r = mul(parentR, local);
    const rt = apply(parentR, localT);
    const t: Vec = [rt[0] + parentT[0], rt[1] + parentT[1], rt[2] + parentT[2]];

    visitor(el, r, t);
    for (const child of el.children ?? []) visit(child, r, t);
  };
  for (const el of shape.elements) visit(el, IDENTITY, [0, 0, 0]);
}

/** Unit quaternion (x, y, z, w) to a row-major rotation matrix. */
function fromQuaternion([x, y, z, w]: [number, number, number, number]): Mat3 {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

/**
 * Moves boxes rigidly: every point p goes to `r * (scale * p) + t` (1/16 block units; `r` a row-major rotation, `scale` uniform). A box keeps
 * its faces and gets the rotation composed into its own.
 */
export function transformBoxes(boxes: ShapeBox[], r: ElementFrame["r"], t: ElementFrame["t"], scale = 1): ShapeBox[] {
  return boxes.map((b) => {
    const c = apply(r, [b.x * scale, b.y * scale, b.z * scale]);
    const own = b.quaternion ? fromQuaternion(b.quaternion) : IDENTITY;
    const total = mul(r, own);
    return {
      ...b,
      x: c[0] + t[0], y: c[1] + t[1], z: c[2] + t[2],
      sx: b.sx * scale, sy: b.sy * scale, sz: b.sz * scale,
      ...(isIdentity(total) ? { quaternion: undefined } : { quaternion: toQuaternion(total) }),
    };
  });
}

/** Rotation matrix for the shape files' rotationX/Y/Z in degrees (the game's order: X, then Y, then Z). */
export function rotationMatrix(rx: number, ry: number, rz: number): ElementFrame["r"] {
  return rotation(rx, ry, rz);
}

/** A collectible's `tpHandTransform` (translation in blocks, rotation in degrees, uniform scale, origin in blocks). */
export interface HandTransform {
  translation: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  origin: [number, number, number];
}

/** The game's default third-person hand transform of an item (`ModelTransform.ItemDefaultTp`); `origin` is the 0.5 block default. */
export const ITEM_HAND_TRANSFORM: HandTransform = { translation: [-1.5, -1.6, -1.4], rotation: [0, -62, 18], scale: 0.33, origin: [0.5, 0.5, 0.5] };
/** The same for a block (`ModelTransform.BlockDefaultTp`). */
export const BLOCK_HAND_TRANSFORM: HandTransform = { translation: [-1.2, -0.9, -0.5], rotation: [0, 0, 0], scale: 0.4, origin: [0.5, 0.5, 0.5] };

/**
 * Places a held item's boxes in the player's hand, the way the game's `EntityShapeRenderer.RenderItem` builds the matrix:
 * `anchor * translate(origin) * scale * translate(attachPos + translation) * rotate(attachRot + rotation) * translate(-origin)`,
 * where `anchor` is the hand element's posed frame (`elementFrame`) and the attachment point sits at `attachPos` (1/16 units) with
 * `attachRot` (degrees) inside it. The item's boxes are in 1/16 units, its transform's values in blocks.
 */
export function holdInHand(
  boxes: ShapeBox[], anchor: ElementFrame, attach: { pos: Vec; rot: Vec }, hand: HandTransform,
): ShapeBox[] {
  const o = hand.origin.map((n) => n * 16) as Vec;
  const c = [0, 1, 2].map((i) => attach.pos[i] + hand.translation[i] * 16) as Vec;
  const R = rotation(attach.rot[0] + hand.rotation[0], attach.rot[1] + hand.rotation[1], attach.rot[2] + hand.rotation[2]);
  const s = hand.scale;
  // p' = anchor.r * (o + s * (R (p - o) + c)) + anchor.t = (anchor.r * R * s) p + anchor.r * (o + s*c - s*R*o) + anchor.t
  const Ro = apply(R, o);
  const inner: Vec = [o[0] + s * c[0] - s * Ro[0], o[1] + s * c[1] - s * Ro[1], o[2] + s * c[2] - s * Ro[2]];
  const lever = apply(anchor.r, inner);
  return transformBoxes(boxes, mul(anchor.r, R), [lever[0] + anchor.t[0], lever[1] + anchor.t[1], lever[2] + anchor.t[2]], s);
}
