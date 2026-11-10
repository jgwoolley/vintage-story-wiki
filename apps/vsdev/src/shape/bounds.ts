// Where a built shape's boxes are in space, turns included. The frames follow the game's `ShapeElement.GetLocalTransformMatrix`
// (`parent * translate(origin) * Rx * Ry * Rz * translate(from - origin)`), with the same rotation matrix the renderer uses, so the
// numbers match what `vsdev render` draws. Used for the bounds `vsdev shape` prints and for "ground" (rest a piece on y = 0).
import { rotationMatrix } from "@nf3t/vs-schematic/shapeBoxes.js";

type Vec3 = [number, number, number];
type Mat3 = ReturnType<typeof rotationMatrix>;
type Json = Record<string, unknown>;
export interface Bounds { min: Vec3; max: Vec3 }

const apply = (m: Mat3, v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mul = (a: Mat3, b: Mat3): Mat3 => a.map((_, k) => a[k - (k % 3)] * b[k % 3] + a[k - (k % 3) + 1] * b[3 + (k % 3)] + a[k - (k % 3) + 2] * b[6 + (k % 3)]) as Mat3;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** Every element with its frame: where its "from" corner is (t) and how it is turned (r), parents included. */
export function elementFrames(elements: Json[]): { el: Json; r: Mat3; t: Vec3 }[] {
  const out: { el: Json; r: Mat3; t: Vec3 }[] = [];
  const walk = (els: Json[], r: Mat3, t: Vec3) => {
    for (const el of els) {
      const from = el.from as Vec3, origin = (el.rotationOrigin as Vec3 | undefined) ?? [0, 0, 0];
      const local = rotationMatrix(num(el.rotationX), num(el.rotationY), num(el.rotationZ));
      const frameR = mul(r, local), frameT = add(t, apply(r, add(origin, apply(local, sub(from, origin)))));
      out.push({ el, r: frameR, t: frameT });
      if (Array.isArray(el.children)) walk(el.children as Json[], frameR, frameT);
    }
  };
  walk(elements, rotationMatrix(0, 0, 0), [0, 0, 0]);
  return out;
}

export const frameApply = apply;

/** The box around every element that has a face (pivots count for nothing), children included; undefined when there is none. */
export function shapeBounds(elements: Json[]): Bounds | undefined {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { el, r, t } of elementFrames(elements)) {
    if (!Object.keys((el.faces as Json | undefined) ?? {}).length) continue;
    const span = sub(el.to as Vec3, el.from as Vec3);
    for (let corner = 0; corner < 8; corner++) {
      const p = add(t, apply(r, span.map((s, i) => ((corner >> i) & 1 ? s : 0)) as Vec3));
      p.forEach((v, i) => { min[i] = Math.min(min[i], v); max[i] = Math.max(max[i], v); });
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : undefined;
}
