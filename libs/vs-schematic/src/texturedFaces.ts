// Geometry for the voxel viewer's textured mode: each box face becomes a quad with the UVs the shape file gives it, grouped by
// texture so the viewer draws one mesh per texture. Pure maths on three's vector types (no WebGL, no DOM), so it is unit tested
// under Node. The face layout follows the game's (and the model editor's): seen from outside, a face's uv [u1, v1] is its
// top-left corner and [u2, v2] its bottom-right, with v growing down the image; `up` has north at its top, `down` has south.

import { Quaternion, Vector3 } from "three";
import type { FaceSide } from "./shapeBoxes.js";

export type { FaceSide };

export interface ViewerFace {
  side: FaceSide;
  /** Texture key; looked up in the viewer's `textures`. A face whose texture wasn't supplied is drawn plain in the box's color. */
  texture: string;
  /** [u1, v1, u2, v2] as fractions of the image, v down from the top. */
  uv: [number, number, number, number];
  /** Clockwise rotation of the texture on the face, in degrees (multiples of 90). */
  rotation?: number;
}

/** A box to draw with faces: center, size, optional rotation about its center (as in ViewerVoxel). */
export interface FacedBox {
  x: number;
  y: number;
  z: number;
  sx?: number;
  sy?: number;
  sz?: number;
  quaternion?: [number, number, number, number];
  faces?: ViewerFace[];
}

type Corner = [number, number, number];

/** Each face's corners on a unit cube centered on 0, as seen from outside: top-left, top-right, bottom-right, bottom-left. */
const FACE_CORNERS: Record<FaceSide, { corners: [Corner, Corner, Corner, Corner]; normal: Corner }> = {
  north: { corners: [[0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5]], normal: [0, 0, -1] },
  south: { corners: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]], normal: [0, 0, 1] },
  east: { corners: [[0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]], normal: [1, 0, 0] },
  west: { corners: [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5]], normal: [-1, 0, 0] },
  up: { corners: [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]], normal: [0, 1, 0] },
  down: { corners: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]], normal: [0, -1, 0] },
};

/** Buffers for one mesh: two triangles per face, each triangle remembering which voxel it belongs to (for picking). */
export interface FaceBuffers {
  positions: number[];
  normals: number[];
  /** Texture coordinates for three.js (flipY textures): t = 1 - v. */
  uvs: number[];
  /** Per-vertex RGB, 0..1; the box's color for plain faces, white for textured ones. */
  colors: number[];
  /** Voxel index of each triangle. */
  triangleVoxels: number[];
}

const newBuffers = (): FaceBuffers => ({ positions: [], normals: [], uvs: [], colors: [], triangleVoxels: [] });

/** The full-image UV rectangle given to plain (untextured) faces, so the edge texture outlines each face. */
const PLAIN_UV: ViewerFace["uv"] = [0, 0, 1, 1];

/**
 * Builds one set of buffers per texture key for `boxes`, moved by `-offset` (the viewer centers the model on the origin).
 * Faces whose texture isn't in `available` go to the "" group, colored with their box's `color` (r, g, b in 0..1).
 */
export function buildFaceBuffers<B extends FacedBox>(
  entries: { box: B; index: number; color: [number, number, number] }[],
  available: (texture: string) => boolean,
  offset: { x: number; y: number; z: number },
): Map<string, FaceBuffers> {
  const groups = new Map<string, FaceBuffers>();
  const q = new Quaternion();
  const p = new Vector3();
  const n = new Vector3();
  for (const { box, index, color } of entries) {
    if (box.quaternion) q.set(...box.quaternion);
    else q.identity();
    for (const face of box.faces ?? []) {
      const textured = available(face.texture);
      const key = textured ? face.texture : "";
      let group = groups.get(key);
      if (!group) groups.set(key, (group = newBuffers()));
      const { corners, normal } = FACE_CORNERS[face.side];
      const [u1, v1, u2, v2] = textured ? face.uv : PLAIN_UV;
      // The image's corners in the same order as the face's: top-left, top-right, bottom-right, bottom-left.
      const uvCorners: [number, number][] = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
      // A clockwise rotation by k quarter turns shows the image corner k steps back (counter-clockwise) at each face corner.
      const k = textured ? Math.round(((face.rotation ?? 0) % 360) / 90) & 3 : 0;
      n.set(...normal).applyQuaternion(q);
      corners.forEach((c, i) => {
        p.set(c[0] * (box.sx ?? 1), c[1] * (box.sy ?? 1), c[2] * (box.sz ?? 1)).applyQuaternion(q);
        group.positions.push(p.x + box.x - offset.x, p.y + box.y - offset.y, p.z + box.z - offset.z);
        group.normals.push(n.x, n.y, n.z);
        const [u, v] = uvCorners[(i - k + 4) & 3];
        group.uvs.push(u, 1 - v);
        if (textured) group.colors.push(1, 1, 1);
        else group.colors.push(...color);
      });
      group.triangleVoxels.push(index, index);
    }
  }
  return groups;
}

/** Triangle indices for `quads` quads laid out as buildFaceBuffers writes them (top-left, top-right, bottom-right, bottom-left), counter-clockwise from outside. */
export function quadIndices(quads: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < quads; i++) {
    const b = i * 4;
    out.push(b, b + 3, b + 2, b, b + 2, b + 1);
  }
  return out;
}
