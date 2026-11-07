import { test } from "node:test";
import assert from "node:assert/strict";
import { gameAssetsCandidates, modelLocation, parseTextureRef, resolveTextures, shapeTextureRefs, textureCandidates } from "../src/textureFiles.js";

test("modelLocation finds the assets folder and domain above shapes/", () => {
  assert.deepEqual(modelLocation("/mods/x/assets/mymod/shapes/item/loom.json"), { assetsDir: "/mods/x/assets", domain: "mymod" });
  // The last "shapes" counts: a folder called shapes higher up doesn't confuse it.
  assert.deepEqual(modelLocation("/shapes/assets/survival/shapes/block/a.json"), { assetsDir: "/shapes/assets", domain: "survival" });
  assert.equal(modelLocation("/tmp/loose.json"), undefined);
});

test("parseTextureRef applies the default domain and drops .png", () => {
  assert.deepEqual(parseTextureRef("block/linen", "mymod"), { domain: "mymod", path: "block/linen" });
  assert.deepEqual(parseTextureRef("game:block/metal/sheet/brass1.png", "mymod"), { domain: "game", path: "block/metal/sheet/brass1" });
  assert.deepEqual(parseTextureRef("Game:/block/x", "mymod"), { domain: "game", path: "block/x" });
});

test("the game domain is searched in survival, game and creative; the model's tree before the game folder", () => {
  const model = { assetsDir: "/m/assets", domain: "mymod" };
  assert.deepEqual(textureCandidates("game:block/linen", model, "/vs/assets"), [
    "/m/assets/survival/textures/block/linen.png",
    "/m/assets/game/textures/block/linen.png",
    "/m/assets/creative/textures/block/linen.png",
    "/vs/assets/survival/textures/block/linen.png",
    "/vs/assets/game/textures/block/linen.png",
    "/vs/assets/creative/textures/block/linen.png",
  ]);
  assert.deepEqual(textureCandidates("item/loom", model, "/vs/assets"), ["/m/assets/mymod/textures/item/loom.png", "/vs/assets/mymod/textures/item/loom.png"]);
  // A loose file (no assets tree) defaults to the game domain and only the game folder.
  assert.deepEqual(textureCandidates("block/linen", undefined, undefined), []);
  assert.equal(textureCandidates("block/linen", undefined, "/vs/assets").length, 3);
});

test("gameAssetsCandidates accepts the install folder or its assets folder", () => {
  assert.deepEqual(gameAssetsCandidates("/opt/vintagestory/"), ["/opt/vintagestory/assets", "/opt/vintagestory"]);
});

test("shapeTextureRefs keeps string entries only", () => {
  assert.deepEqual(shapeTextureRefs({ textures: { a: "block/a", b: 3 } }), { a: "block/a" });
  assert.deepEqual(shapeTextureRefs({ elements: [] }), {});
  assert.deepEqual(shapeTextureRefs(null), {});
});

test("resolveTextures reads the first existing candidate and reports the rest as missing", async () => {
  const files: Record<string, Uint8Array> = { "/vs/assets/game/textures/block/linen.png": new Uint8Array([1, 2, 3]) };
  const read: string[] = [];
  const result = await resolveTextures(
    { textures: { cloth: "game:block/linen", gone: "block/nothing" } },
    "/m/assets/mymod/shapes/item/loom.json",
    "/vs/assets",
    async (path) => (read.push(path), files[path]),
  );
  assert.deepEqual(result.images, { cloth: "data:image/png;base64,AQID" });
  assert.deepEqual(result.missing, [{ key: "gone", ref: "block/nothing" }]);
  // Stops at the hit: survival was tried before game, creative never.
  assert.ok(read.includes("/vs/assets/survival/textures/block/linen.png"));
  assert.ok(!read.includes("/vs/assets/creative/textures/block/linen.png"));
});
