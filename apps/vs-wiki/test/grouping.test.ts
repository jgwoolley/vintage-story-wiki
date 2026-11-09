import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVariantGroups, type GroupCandidate } from "../src/ingest/grouping.js";

const c = (code: string, pattern: string, inCreative = false): GroupCandidate => ({ domain: "survival", code, patterns: [pattern], inCreative });
const all = (cs: GroupCandidate[]) => new Set(cs.map((x) => `${x.domain}:${x.code}`));

test("placeholders keep different families apart: armor groups per body part and construction, not all armor", () => {
  const cs = [
    c("armor-body-lamellar-iron", "armor-body-lamellar-*"),
    c("armor-body-lamellar-steel", "armor-body-lamellar-*"),
    c("armor-body-jerkin-iron", "armor-body-jerkin-*"),
    c("armor-body-jerkin-steel", "armor-body-jerkin-*"),
    c("armor-head-lamellar-iron", "armor-head-lamellar-*"),
  ];
  const groups = buildVariantGroups(cs, all(cs));
  assert.deepEqual(groups.map((g) => g.members.length).sort(), [2, 2]); // the lone head piece forms no group
});

test("the primary is the variant the creative inventory lists, otherwise the first by code", () => {
  const cs = [c("plank-b", "plank-*"), c("plank-a", "plank-*"), c("plank-c", "plank-*", true)];
  assert.equal(buildVariantGroups(cs, all(cs))[0].primary, "survival:plank-c");
  const none = [c("plank-b", "plank-*"), c("plank-a", "plank-*")];
  assert.equal(buildVariantGroups(none, all(none))[0].primary, "survival:plank-a");
});

test("only entries in the item index count towards a group", () => {
  const cs = [c("x-a", "x-*"), c("x-b", "x-*")];
  assert.equal(buildVariantGroups(cs, new Set(["survival:x-a"])).length, 0);
});

test("a one-per-painting pattern forms no group, like the game", () => {
  const cs = [c("painting-howl-north", "painting-howl-*"), c("painting-elk-north", "painting-elk-*")];
  assert.equal(buildVariantGroups(cs, all(cs)).length, 0);
});

test("a code expanded twice is one member", () => {
  const cs = [c("x-a", "x-*"), c("x-a", "x-*"), c("x-b", "x-*")];
  assert.deepEqual(buildVariantGroups(cs, all(cs))[0].members, ["survival:x-a", "survival:x-b"]);
});
