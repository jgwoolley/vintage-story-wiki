import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteHandbookLinks, handbookItemRefs } from "../src/ingest/codeUtil.js";

test("item/block links resolve to /items/ pages and are recorded", () => {
  handbookItemRefs.clear();
  assert.equal(rewriteHandbookLinks('<a href="handbook://block-muddygravel">x</a>'), '<a href="__LANG__items/survival/muddygravel/">x</a>');
  assert.equal(handbookItemRefs.get("survival:muddygravel"), "block");
  assert.equal(rewriteHandbookLinks('href="handbook://item-nugget-chromite"'), 'href="__LANG__items/survival/nugget-chromite/"');
  assert.equal(handbookItemRefs.get("survival:nugget-chromite"), "item");
});

test("a domain-prefixed code keeps its domain instead of being glued onto the path", () => {
  handbookItemRefs.clear();
  assert.equal(
    rewriteHandbookLinks('href="handbook://item-stonequarry:chisel-finishing-copper"'),
    'href="__LANG__items/stonequarry/chisel-finishing-copper/"',
  );
  assert.ok(handbookItemRefs.has("stonequarry:chisel-finishing-copper"));
  assert.equal(rewriteHandbookLinks('href="handbook://block-game:rock-granite"'), 'href="__LANG__items/survival/rock-granite/"');
});

test("guide links resolve for any mod's guide when its pageCode is known", () => {
  const known = new Map([["stonequarry-quarryguide", "stonequarry"]]);
  assert.equal(rewriteHandbookLinks('href="handbook://stonequarry-quarryguide"', known), 'href="__LANG__guides/stonequarry/stonequarry-quarryguide/"');
  assert.equal(rewriteHandbookLinks('href="handbook://craftinginfo-knapping"'), 'href="__LANG__guides/survival/craftinginfo-knapping/"');
  // unknown pageCodes are left alone rather than guessed at
  assert.equal(rewriteHandbookLinks('href="handbook://nosuchguide"'), 'href="handbook://nosuchguide"');
});

test("handbooksearch links become an items search", () => {
  assert.equal(rewriteHandbookLinks('href="handbooksearch://wild honey"'), 'href="__LANG__items/?q=wild%20honey"');
});
