// Statues (Player Statues mod) in a rendered schematic: the block entity is decoded, built through `@nf3t/vs-schematic/statue.js` and
// drawn instead of its block; the invisible multiblock parts around it are left out. No game files: the shapes are hand-written.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { StatueIo } from "@nf3t/vs-schematic/statue.js";
import { schematicBoxes } from "../src/render/inputs.js";
import { schematicStatues } from "../src/render/statues.js";

// ---- a minimal TreeAttribute + Ascii85 encoder (see libs/vs-schematic/test/schematicDecode.test.ts) ----
const str = (s: string) => {
  const b = [...Buffer.from(s, "utf8")];
  return [b.length, ...b];
};
const f32 = (n: number) => [...new Uint8Array(new Float32Array([n]).buffer)];
const tag = (id: number, key: string, payload: number[]) => [id, ...str(key), ...payload];
function ascii85(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = bytes.slice(i, i + 4);
    const n = chunk.length;
    while (chunk.length < 4) chunk.push(0);
    let v = ((chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3]) >>> 0;
    let group = "";
    for (let d = 0; d < 5; d++) {
      group = String.fromCharCode(33 + (v % 85)) + group;
      v = Math.floor(v / 85);
    }
    out += group.slice(0, n + 1);
  }
  return out;
}

const face = { texture: "#seraph", uv: [0, 0, 4, 4] };
const BODY = { elements: [{ name: "LowerTorso", from: [6, 0, 6], to: [10, 30, 10], faces: { north: face, up: face } }], animations: [] };
const io: StatueIo = {
  shape: async (ref) => (ref === "game:shapes/entity/humanoid/seraph-faceless.json" ? structuredClone(BODY) : undefined),
};

test("schematic statues: the block entity's figure replaces the block, turned by meshAngleY; multiblock parts are left out", async () => {
  const entity = ascii85([...tag(5, "emote", str("none")), ...tag(4, "meshAngleY", f32(Math.PI / 4)), ...tag(9, "noPedestal", [1]), 0]);
  const schematic = {
    Indices: [0, 1, 2], BlockIds: [1, 2, 3],
    BlockCodes: { 1: "nf3tstatue:statue-small-whitemarble", 2: "game:multiblock-monolithic-p1-0-0", 3: "game:rock-granite" },
    BlockEntities: { 0: entity },
  };
  const { statues, warnings } = await schematicStatues(schematic, io);
  assert.deepEqual(warnings, []);
  assert.equal(statues.size, 1);
  const input = schematicBoxes(schematic, { showFiller: false, chisel: true, statues });
  assert.equal(input.summary.statues, 1);
  assert.equal(input.summary.multiblock, 1);
  assert.equal(input.boxes.length, 2, "the statue's one box and the granite; the multiblock part draws nothing");
  const [figure] = input.boxes;
  // 30 px tall body at scale 0.5 = 15 px = 0.9375 block, standing on the cell's floor (y - 0.5), with no pedestal lift.
  assert.ok(Math.abs(figure.sy! - 0.9375) < 1e-9 && Math.abs(figure.y - (-0.5 + 0.9375 / 2)) < 1e-9);
  assert.ok(figure.quaternion, "turned by meshAngleY");
  assert.equal(input.codes[figure.code], "game:rock-whitemarble", "colored as its rock");

  // Without the statue io, a statue is just its block.
  assert.equal(schematicBoxes(schematic, { showFiller: false, chisel: true }).summary.statues, 0);
});
