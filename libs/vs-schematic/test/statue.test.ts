// The Player Statues mod's geometry (statue.ts, a port of StatueMesh/StatuePose): design parsing, the shape surgery, the pose and the
// placement, on small hand-written shapes (no game files).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStatue, emptyStatueDesign, isStatueBlock, peakKeyframe, poseAt, removeElements, statueDesignFromTree, statueMaterial, stepParent,
  useSingleTile, STATUE, type StatueIo,
} from "../src/statue.js";
import type { CompactAnimation } from "../src/shapeBoxes.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const face = { texture: "#seraph", uv: [3, 4, 9, 9] };
const faces = { north: { ...face }, east: { ...face }, south: { ...face }, west: { ...face }, up: { ...face }, down: { ...face } };

/** A tiny "seraph": a torso with a neck, a head and a hand anchor, and one emote that turns the torso. */
const BODY = {
  textureWidth: 64, textureHeight: 64, textureSizes: { seraph: [64, 64] },
  elements: [{
    name: "LowerTorso", from: [6, 10, 6], to: [10, 20, 10], faces,
    children: [
      { name: "Neck", from: [1, 10, 1], to: [3, 11, 3], faces, children: [{ name: "Head", from: [-1, 1, -1], to: [5, 5, 5], faces, children: [{ name: "Hair", from: [0, 4, 0], to: [4, 5, 4], faces }] }] },
      { name: "ItemAnchor", from: [4, 0, 1], to: [5, 1, 2], attachmentpoints: [{ code: "RightHand", posX: "0", posY: "0", posZ: "0", rotationX: "0", rotationY: "0", rotationZ: "0" }] },
    ],
  }],
  animations: [{ code: "bow", quantityframes: 20, onAnimationEnd: "EaseOut", keyframes: [
    { frame: 0, elements: { LowerTorso: { rotationX: 0 } } },
    { frame: 10, elements: { LowerTorso: { rotationX: 30 }, Head: { rotationY: 5 } } },
    { frame: 15, elements: { LowerTorso: { rotationX: 10 } } },
  ] }],
};
const HELMET = { elements: [{ name: "Helmet", stepParentName: "head", from: [-1, 2, -1], to: [5, 6, 5], faces }] };
const PEDESTAL = { elements: [{ name: "Pedestal", from: [2, 0, 2], to: [14, 2, 14], faces: { up: { texture: "#stone", uv: [2, 2, 14, 14] } } }] };
const ROBOT = { elements: [{ name: "Pedestal", from: [0, 0, 0], to: [16, 2, 16], faces }, { name: "Body", from: [6, 2, 6], to: [10, 32.8, 10], faces }] };

const fakeIo = (extra: Record<string, unknown> = {}): StatueIo & { asked: string[] } => {
  const files: Record<string, unknown> = {
    "game:shapes/entity/humanoid/seraph-faceless.json": BODY,
    "survival:shapes/entity/humanoid/seraph/armor/helmet.json": HELMET,
    "nf3tstatue:shapes/block/pedestal.json": PEDESTAL,
    "nf3tstatue:shapes/block/robot.json": ROBOT,
    ...extra,
  };
  const asked: string[] = [];
  return {
    asked,
    shape: async (ref) => (asked.push(ref), structuredClone(files[ref])),
    collectible: async (code) => code === "game:armor-head-x"
      ? { shape: "survival:shapes/item/helmet-inv.json", worn: { shape: "survival:shapes/entity/humanoid/seraph/armor/helmet.json", disable: ["hair", "Head"], keep: ["head"] }, hand: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1, origin: [0.5, 0.5, 0.5] } }
      : undefined,
  };
};

test("statue blocks and their material: rock texture and block color, metals' sheets (gold: plate)", () => {
  assert.ok(isStatueBlock("nf3tstatue:statue-small-whitemarble") && isStatueBlock("nf3tstatue:statuemetal-bust-gold"));
  assert.ok(!isStatueBlock("nf3tstatue:statuemold-small-fired") && !isStatueBlock("game:statue-small-granite"));
  assert.deepEqual(statueMaterial("nf3tstatue:statue-large-redmarble"), { texture: "game:block/stone/rock/redmarble1", colorCode: "game:rock-redmarble" });
  assert.equal(statueMaterial("nf3tstatue:statuemetal-small-gold").texture, "game:block/metal/plate/gold");
  assert.equal(statueMaterial("nf3tstatue:statuemetal-small-brass").texture, "game:block/metal/sheet-plain/brass3");
  assert.equal(statueMaterial("nf3tstatue:statuemetal-small-copper").texture, "game:block/metal/sheet-plain/copper1");
});

test("statueDesignFromTree: the block entity's fields, stacks through the schematic's code tables, bad values dropped", () => {
  const stack = (itemClass: "item" | "block", id: number) => ({ itemClass, id, stackSize: 1, attributes: {} });
  const d = statueDesignFromTree({
    emote: "cheer", frame: 12, meshAngleY: 1.5, statueType: "dragon", skinShapes: "game:a;game:b", mount: "elkbull", elkPose: "gallop",
    antlers: 99, tack: "bridle1;face99;saddle1", noPedestal: true, clayLevel: 3,
    armorCount: 2, armor0: stack("item", 7), armor1: stack("item", 404), clothingCount: 0, hands0: stack("block", 2), hands1: null,
  }, "nf3tstatue:statue-small-granite", { itemCodes: { 7: "armor-head-x" }, blockCodes: { 2: "survival:torch-up" } });
  assert.equal(d.type, "player", "an unknown type is a player statue");
  assert.deepEqual([d.emote, d.frame, d.angleY, d.mount, d.elkPose, d.antlers, d.noPedestal, d.clayLevel], ["cheer", 12, 1.5, "elkbull", "gallop", 8, true, 3]);
  assert.deepEqual(d.skinShapes, ["game:a", "game:b"]);
  assert.deepEqual(d.armor, ["game:armor-head-x"], "an id missing from ItemCodes is dropped");
  assert.equal(d.rightHand, "survival:torch-up");
  assert.equal(d.leftHand, undefined);
  assert.deepEqual(d.tack, ["bridle1", "", "saddle1", ""], "an unknown tack type is dropped");
  assert.equal(statueDesignFromTree({ nf3tstatue: { emote: "wave" } }, "x").emote, "wave", "a statue item's nf3tstatue tree");
});

test("useSingleTile: one 16 px tile per face, sized by the element and clamped to 1..16, all on one texture", () => {
  const raw = { textureSizes: { a: [64, 64] }, elements: [{ from: [0, 0, 0], to: [0.5, 20, 4], faces: { north: { texture: "#a", uv: [9, 9, 1, 1], rotation: 90 }, up: { texture: "#b" } } }] };
  useSingleTile(raw as never);
  const f = raw.elements[0].faces as unknown as Record<string, { texture: string; uv: number[]; rotation?: number }>;
  assert.deepEqual(f.north, { texture: "#stone", uv: [0, 0, 1, 16] });
  assert.deepEqual(f.up.uv, [0, 0, 1, 4]);
  assert.equal((raw as { textureSizes?: unknown }).textureSizes, undefined);
});

test("stepParent and removeElements follow the game's Shape: names ignore case, nested step parents lift out, loose ones are dropped", () => {
  const body = structuredClone(BODY) as never as { elements: { name: string; children?: { name: string; children?: unknown[] }[] }[] };
  const missing = stepParent(body as never, { elements: [
    { name: "A", stepParentName: "HEAD", from: [0, 0, 0], to: [1, 1, 1], children: [{ name: "B", stepParentName: "neck", from: [0, 0, 0], to: [1, 1, 1] }] },
    { name: "Loose", from: [0, 0, 0], to: [1, 1, 1] },
    { name: "C", stepParentName: "Tail", from: [0, 0, 0], to: [1, 1, 1] },
  ] } as never);
  assert.deepEqual(missing, ["Tail"]);
  const names = JSON.stringify(body);
  assert.ok(names.includes('"A"') && names.includes('"B"') && !names.includes("Loose"));
  const neck = body.elements[0].children![0];
  assert.ok((neck.children as { name: string }[]).some((c) => c.name === "B"), "B moved from A to Neck");
  removeElements(body as never, ["hair"]);
  assert.ok(!JSON.stringify(body).includes('"Hair"'));
});

test("poses: the peak keyframe skips frame 0 and counts only the given bones; poseAt holds outside the keyframes", () => {
  const animations: CompactAnimation[] = [{ code: "bow", frames: 20, loop: false, keyframes: [
    { frame: 0, elements: { T: {} } }, { frame: 10, elements: { T: { rx: 30 }, H: { ry: 5 } } }, { frame: 15, elements: { T: { rx: 10 }, H: { ry: 50 } } },
  ] }];
  assert.equal(peakKeyframe(animations[0])!.frame, 15);
  assert.equal(peakKeyframe(animations[0], new Set(["T"]))!.frame, 10);
  near(poseAt(animations[0], 5).T.rx!, 15);
  near(poseAt(animations[0], 19).T.rx!, 10, 1e-9);
  near(poseAt(animations[0], 0).H.ry!, 5, 1e-9);
});

test("buildStatue: an uncarved block is its pedestal; a carved one is the posed body at the small scale, on the pedestal, in one stone", async () => {
  const io = fakeIo();
  const blank = await buildStatue(emptyStatueDesign("nf3tstatue:statue-small-granite"), io);
  assert.equal(blank.boxes.length, 1);
  assert.deepEqual(blank.textures, { stone: "game:block/stone/rock/granite1" });

  const standing = await buildStatue({ ...emptyStatueDesign("nf3tstatue:statue-small-granite"), emote: "none" }, io);
  const torso = standing.boxes[1];
  // LowerTorso 6..10 x 10..20 scaled 0.5 about (8, 0, 8) -> 7..9 x 5..10, then 2 px up onto the pedestal.
  near(torso.x, 8); near(torso.y, 9.5); near(torso.sy, 5);
  assert.ok(torso.faces!.every((f) => f.texture === "stone" && f.uv[0] === 0 && f.uv[1] === 0));
  assert.equal(standing.warnings.length, 0);

  const bowed = await buildStatue({ ...emptyStatueDesign("nf3tstatue:statue-small-granite"), emote: "bow" }, io);
  assert.ok(bowed.boxes[1].quaternion, "frame -1 is the peak keyframe: the torso turns");
  const noPedestal = await buildStatue({ ...emptyStatueDesign("nf3tstatue:statue-small-granite"), emote: "none", noPedestal: true }, io);
  assert.equal(noPedestal.boxes.length, standing.boxes.length - 1, "no pedestal");
  near(noPedestal.boxes[0].y, 7.5, 1e-9);

  const turned = await buildStatue({ ...emptyStatueDesign("nf3tstatue:statue-small-granite"), emote: "none", angleY: Math.PI / 2, noPedestal: true }, io);
  near(turned.boxes[0].x, 8); near(turned.boxes[0].z, 8);
  const head = turned.boxes.at(-2)!, plainHead = noPedestal.boxes.at(-2)!;
  near(head.x - 8, plainHead.z - 8); near(head.z - 8, -(plainHead.x - 8));
});

test("buildStatue: armor hides what it disables (minus what it keeps), a bust shows only the neck up, a special shape drops its slab", async () => {
  const io = fakeIo();
  const plain = await buildStatue({ ...emptyStatueDesign("nf3tstatue:statue-small-granite"), emote: "none", noPedestal: true }, io);
  const armored = await buildStatue({ ...emptyStatueDesign("nf3tstatue:statue-small-granite"), emote: "none", noPedestal: true, armor: ["game:armor-head-x"] }, io);
  // Hair goes, Head is kept (keep wins), the helmet is added.
  assert.equal(armored.boxes.length, plain.boxes.length);
  assert.ok(io.asked.includes("survival:shapes/entity/humanoid/seraph/armor/helmet.json"), "the worn shape, not the inventory one");

  const bust = await buildStatue({ ...emptyStatueDesign("nf3tstatue:statue-bust-granite"), emote: "none", noPedestal: true }, io);
  assert.equal(bust.boxes.length, 3, "neck, head and hair only");
  const lowest = Math.min(...bust.boxes.map((b) => b.y - b.sy / 2));
  near(lowest, 0, 1e-9);

  const robot = await buildStatue({ ...emptyStatueDesign("nf3tstatue:statue-small-granite"), type: "robot", noPedestal: true }, io);
  assert.equal(robot.boxes.length, 1, "only the body: the shape's own slab is left out, and noPedestal drops the block's");
  const body = robot.boxes[0];
  near(body.sy, 30.8 * (0.875 / (30.8 / 16)), 1e-6);

  const clay = await buildStatue({ ...emptyStatueDesign("nf3tstatue:statue-small-granite"), emote: "none", clayLevel: 4 }, io);
  assert.equal(clay.textures.clay, "game:block/clay/fireclay");
  assert.equal(clay.boxes.at(-1)!.texture, "clay");
});

test("buildStatue: missing files are warnings; game: refs are also looked up in survival and creative", async () => {
  const io = fakeIo();
  const r = await buildStatue({ ...emptyStatueDesign("nf3tstatue:statue-small-granite"), emote: "none", armor: ["game:nope"], rightHand: "game:nope2" }, io);
  assert.ok(r.warnings.some((w) => w.includes("game:nope")));
  const r2 = await buildStatue({ ...emptyStatueDesign("nf3tstatue:statue-small-granite"), mount: "elkcow", emote: "riding" }, io);
  assert.ok(io.asked.includes("survival:shapes/entity/animal/mammal/hooved/deer/elk/female.json"));
  assert.ok(r2.warnings.some((w) => w.includes(STATUE.elkShape)));
});
