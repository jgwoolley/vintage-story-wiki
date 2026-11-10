// Game shapes as a starting point, for a JS shape spec:
// - `gameShape("entity/humanoid/seraph-faceless")` reads a shape from the game install (found like `vsdev render` finds it: --game-dir,
//   $VINTAGE_STORY, vs-manifest.json, ./vintagestory, the installed game);
// - `statue(shape, { animation, keyframe, texture, scale, drop, attach })` turns it into a statue the way the Player Statues mod does
//   (StatueMod/StatueMesh.cs, StatuePose.cs): a keyframe of one of the shape's own animations baked into its elements, every face on one
//   material tile sized by the face, the whole drawn k times bigger, some elements dropped, and spec elements added to named ones (they
//   follow the pose).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { SpecError } from "../gen/spec.js";
import { defaultLocationEnv, resolveGameDir } from "../locations.js";
import { userCwd } from "../paths.js";
import { scaled } from "./helpers.js";

type Json = Record<string, unknown>;
type Vec3 = [number, number, number];

const cache = new Map<string, Json>();

/** The game install a spec reads shapes from (resolved once per run). */
let gameDirOverride: string | undefined;
export function setGameDir(dir: string | undefined): void {
  gameDirOverride = dir;
}

function gameDir(): string {
  if (gameDirOverride) return gameDirOverride;
  const found = resolveGameDir({ mode: "read" }, defaultLocationEnv(userCwd())).path;
  if (!found) throw new SpecError(`gameShape: no game install found (set one up with \`vsdev game\`, or point $VINTAGE_STORY at it; \`vsdev paths\` shows where it looked)`);
  return found;
}

/**
 * A game shape, parsed: "domain:path" or "path" (domain game), relative to the domain's shapes/ folder, ".json" optional. The game
 * domain's files are spread over assets/game, assets/survival and assets/creative; all three are looked in.
 */
export function gameShape(code: string): Json {
  const m = /^(?:([a-z0-9_-]+):)?(.+?)(?:\.json)?$/.exec(code);
  if (!m) throw new SpecError(`gameShape: "${code}" is not a shape code ("domain:path" or "path")`);
  const domain = m[1] ?? "game", rel = m[2];
  const roots = domain === "game" ? ["game", "survival", "creative"] : [domain];
  const dir = gameDir();
  const tried = roots.map((r) => path.join(dir, "assets", r, "shapes", `${rel}.json`));
  const file = tried.find(existsSync);
  if (!file) throw new SpecError(`gameShape: "${code}" not found (looked at ${tried.join(", ")})`);
  if (!cache.has(file)) cache.set(file, JSON5.parse(readFileSync(file, "utf8")) as Json);
  return structuredClone(cache.get(file)!);
}

export interface StatueOptions {
  /** The shape's own animation to take the pose from. */
  animation?: string;
  /** Up to which of its keyframes (default 0); each element keeps what it last did by then, as the animation plays. */
  keyframe?: number;
  /** Per element { rotationX, offsetY, ... }, on top of the animation's (the keyframe format). */
  pose?: Record<string, Json>;
  /** The texture key every face uses. */
  texture: string;
  /** Drawn this many times bigger (default 1). */
  scale?: number;
  /** Element names (or a pattern) to leave out, with their children. */
  drop?: string[] | RegExp;
  /** Spec elements to add as children of named elements, in that element's frame and the shape's own units (they are scaled too). */
  attach?: Record<string, unknown[]>;
}

const ROT = ["rotationX", "rotationY", "rotationZ"] as const;
const OFF = ["offsetX", "offsetY", "offsetZ"] as const;
const SIDES = ["north", "east", "south", "west", "up", "down"] as const;

/** The pose of `animation` at `keyframe`: for each element, its values in the last keyframe up to there that moves it. */
export function animationPose(shape: Json, animation: string, keyframe = 0): Record<string, Json> {
  const anims = (shape.animations as Json[] | undefined) ?? [];
  const anim = anims.find((a) => a.code === animation);
  if (!anim) throw new SpecError(`statue: the shape has no animation "${animation}" (it has: ${anims.map((a) => a.code).slice(0, 40).join(", ")}${anims.length > 40 ? ", ..." : ""})`);
  const frames = (anim.keyframes as Json[] | undefined) ?? [];
  if (!frames.length) throw new SpecError(`statue: animation "${animation}" has no keyframes`);
  if (!Number.isInteger(keyframe) || keyframe < 0 || keyframe >= frames.length) throw new SpecError(`statue: "keyframe" is 0..${frames.length - 1} for "${animation}"`);
  const pose: Record<string, Json> = {};
  for (const kf of frames.slice(0, keyframe + 1)) Object.assign(pose, (kf.elements as Record<string, Json> | undefined) ?? {});
  return pose;
}

/** The shape's elements made into a statue (game JSON; attached spec elements are built with the rest). */
export function statue(shape: Json, o: StatueOptions): Json[] {
  if (typeof o.texture !== "string") throw new SpecError(`statue: needs "texture", the key every face uses`);
  const k = o.scale ?? 1;
  const pose: Record<string, Json> = o.animation ? animationPose(shape, o.animation, o.keyframe ?? 0) : {};
  for (const [name, p] of Object.entries(o.pose ?? {})) pose[name] = { ...(pose[name] ?? {}), ...p };
  const dropped = (name: unknown) => typeof name === "string" && (o.drop instanceof RegExp ? o.drop.test(name) : (o.drop ?? []).includes(name));
  const r4 = (v: number) => Math.round(v * 1000) / 1000 + 0;

  const convert = (src: Json): Json | null => {
    if (dropped(src.name)) return null;
    const from = [...(src.from as Vec3)] as Vec3, to = [...(src.to as Vec3)] as Vec3;
    const origin = src.rotationOrigin ? ([...(src.rotationOrigin as Vec3)] as Vec3) : undefined;
    const el: Json = { name: src.name };
    for (const r of ROT) if (src[r]) el[r] = src[r];
    const p = typeof src.name === "string" ? pose[src.name] : undefined;
    if (p) {
      for (const r of ROT) if (typeof p[r] === "number" && p[r]) el[r] = ((el[r] as number | undefined) ?? 0) + (p[r] as number);
      const d = OFF.map((key) => (typeof p[key] === "number" ? (p[key] as number) : 0));
      for (const v of [from, to, origin]) if (v) d.forEach((x, i) => (v[i] += x));
    }
    for (const v of [from, to, origin]) if (v) v.forEach((x, i) => (v[i] = r4(x * k)));
    el.from = from;
    el.to = to;
    if (origin) el.rotationOrigin = origin;
    const size = [0, 1, 2].map((i) => Math.min(16, Math.max(0.5, Math.abs(to[i] - from[i]))));
    const solid = [0, 1, 2].some((i) => to[i] !== from[i]);
    const dims: Record<(typeof SIDES)[number], [number, number]> = { north: [size[0], size[1]], south: [size[0], size[1]], east: [size[2], size[1]], west: [size[2], size[1]], up: [size[0], size[2]], down: [size[0], size[2]] };
    el.faces = solid ? Object.fromEntries(SIDES.map((s) => [s, { texture: "#" + o.texture, uv: [0, 0, ...dims[s]] }])) : {};
    const kids = ((src.children as Json[] | undefined) ?? []).map(convert).filter((c): c is Json => !!c);
    const extra = typeof src.name === "string" ? o.attach?.[src.name] : undefined;
    if (extra) kids.push(...(scaled(k, extra) as Json[]));
    if (kids.length) el.children = kids;
    return el;
  };
  return ((shape.elements as Json[] | undefined) ?? []).map(convert).filter((e): e is Json => !!e);
}
