# Recommended vsdev changes

Changes worth making to vsdev, found while using vsdev 0.1.0 on a mod repo (translocator-locator-cmd: `vsdev moddb` pages,
`vsdev moddb export` behind a static web server, `vsdev screenshots` for mod icons and ModDB images). Nothing here is implemented
in the published package. Each item says what goes wrong today, what to change, and how the mod repo works around it meanwhile. A
tested patch for items 1 and 2 is at the end (type check clean, 50/50 vsdev tests passing with it).

## 1. `moddb export`: take what the ModDB page doesn't manage from the zip in `Releases/`

**Today.** Everything on the exported page comes from `moddb/<modid>/page.json` except version, game version, dependencies and
the download. A mod without a logo on its ModDB page (an unpublished or draft mod) gets a blank card, although its zip contains a
`modicon.png`. The side shown is the ModDB page field, which can be wrong (a page said `both` for a server-only mod), while the
zip's `modinfo.json` says what the game actually enforces.

**Change.** Treat the newest zip as the source of truth for the mod itself, and `moddb/` for what the page manages:

| From `moddb/<modid>/` (managed on ModDB) | From the newest zip in `Releases/` |
| --- | --- |
| name, description, tags, links, logo, screenshots, changelogs | version, download, game version, dependencies (as now) |
| | **side** from `modinfo.json` (warn when `page.json` disagrees) |
| | **logo** = the zip's `modicon.png` when `page.json` names none (written as `<modid>/images/modicon.png`) |
| | **description** = `modinfo.json` description when there is no `description.html` |

Needs a small `modIconFromZip(zip)` next to `modInfoFromZip` in `src/mods/modinfo.ts`; `sideOf` from `scaffold.ts` maps
`Universal/Client/Server` to `both/client/server`.

**Meanwhile.** Copy the icon into `moddb/<modid>/images/logo.png` and set `"logo": "logo.png"`, which makes `moddb diff` report a
difference for drafts until the logo is uploaded.

## 2. `screenshots` scenes: render stone statues (`material`), and a few placement gaps

**Today.** A scene part can't be retextured, so a statue (a posed seraph in armor, all in one stone texture, which a mod builds in
code) can't be drawn from the game's shapes.

**Change.**
- `material` on any scene part: one texture for every face of the part, worn and held items included (keys the shape declares and
  keys only its faces name). Validation in `readShots`, help text, and the schema (plus the copies in `skills/*/`).
- Optionally a face-UV mode next to it, e.g. `"materialUv": "tile"`, that resets each face's UVs to one 16 px tile sized by the
  element, as a statue mod does (`UseSingleTile`), instead of stretching the texture over the skin's UV layout.
- `scale` on player parts (today only model parts have it).
- Model `scale` scales about the block corner (0, 0, 0), not the block's bottom center, so a scaled model also moves sideways.
  Scaling about `[8, 0, 8]` (the pivot already used for `rotationY`) matches how the game scales block meshes; at least document it.

**Meanwhile.** The mod repo bakes the statue into a render-only shape file (body + armor step-parented, single-tile UVs, every
texture set to the stone) with a small script, and places it as a `model` part with `scale` and `animation`/`frame`.

## 3. `moddb export` replaces its output folder

**Today.** `clearOutDir` deletes the output folder and creates a new one. A web server that bind-mounts that folder (Docker) keeps
the old, deleted directory and serves nothing until the container is recreated.

**Change.** Empty the folder's contents instead of removing the folder itself (same safety checks).

**Meanwhile.** `docker compose up -d --force-recreate <service>` after each export, or mount the parent folder.

## 4. `screenshots` scenes: worn items don't hide the body parts they cover

**Today.** `disabledElements` (`src/render/collectible.ts`) reads `attributes.disableElements`, but the game's armor lists them in
`attributes.attachableToEntity.disableElements` / `disableElementsByType` (`survival/itemtypes/wearable/seraph/armor.json`). So a
helmet doesn't hide the hair (`Hair`, `Hair tile upper part`), which pokes through it.

**Change.** Also read `attachableToEntity.disableElements(ByType)` (resolved like the other ByType fields, e.g.
`armor-head-antique-*-pristine`), and honour `keepElements` the way the game does (disabled minus kept). Add a test with a helmet.

**Meanwhile.** Draw the hair with the game's transparent texture: `"hair": "../../../../block/transparent"` on the player.

## 5. `moddb serve`: rich-text copy loses code blocks

**Today.** "Copy description (rich text)" puts the page HTML on the clipboard as is (`text/html`, plus `textContent` as
`text/plain`). A bare `<pre>…</pre>` (as a hand-written description tends to have) did not paste into ModDB's editor as a code
block: the JSON example on a mod page lost its formatting. Code blocks the editor makes itself are stored as
`<pre class="language-json"><code>…</code></pre>` (its code-sample markup), and those round-trip. Not verified in the editor
from the tool side (that needs a login); seen by a user pasting.

**Change.**
- In the copied HTML (not the page files), turn a bare `<pre>` into `<pre class="language-plaintext"><code>…</code></pre>`
  (keep an existing `language-*` class), so the editor gets its own code-sample markup.
- `HtmlLint`: warn about a `<pre>` without a `language-*` class and a `<code>` inside, with the fix.
- Next to the rich-text button, say that "Copy HTML source" pasted into the editor's source-code view (`<>`) is the exact route.

**Meanwhile.** Write code blocks in `description.html` / changelogs as `<pre class="language-json"><code>…</code></pre>` with
real line breaks, like the editor stores them.

## Patch (items 1 and 2: `material` only)

<details><summary>git diff</summary>

```diff
diff --git a/apps/vsdev/src/commands/screenshots.ts b/apps/vsdev/src/commands/screenshots.ts
index c005341..a0f44cb 100644
--- a/apps/vsdev/src/commands/screenshots.ts
+++ b/apps/vsdev/src/commands/screenshots.ts
@@ -36,6 +36,7 @@ Scenes: "scene" instead of one source places several parts in one image: models
 ({ "player": { "wear": ["armor-body-antique-forlorn-pristine", ...], "hold": "rod-cupronickel", "holdScale", "animation": "insertgear", "frame": 30 },
 "at", "facing": "west" }). The player is the seraph body in that animation, dressed in the worn items (found by code in the game's
 itemtypes) and holding items at the game's hand attachment points; textures need the game client. Its front is west at rotationY 0.
+Any part takes "material": one texture for all its faces, worn and held items included (a statue: "game:block/stone/rock/whitemarble1").
 Overlay options: title, subtitle, logo (an image file), textAt / logoAt (top-left, top-right, bottom-left, bottom-right), background (a CSS
 color); output is the PNG's path (relative to vs-manifest.json) instead of <screenshotsDir>/<name>.png.
 "schematic" and "model" are each a file relative to vs-manifest.json, or domain:path inside the game install's assets/ or a mod in Mods/ (zip or folder).
@@ -136,6 +137,7 @@ export function readShots(manifest: unknown, file: string): ShotEntry[] {
         if (p.at !== undefined && !(Array.isArray(p.at) && p.at.length === 3 && p.at.every((n) => typeof n === "number"))) fail(`${at}: scene[${j}].at must be [x, y, z] in blocks`);
         if (p.facing !== undefined && !["north", "east", "south", "west"].includes(p.facing as string)) fail(`${at}: scene[${j}].facing must be north, east, south or west`);
         if (p.rotationY !== undefined && typeof p.rotationY !== "number") fail(`${at}: scene[${j}].rotationY must be degrees`);
+        if (p.material !== undefined && (typeof p.material !== "string" || !p.material)) fail(`${at}: scene[${j}].material must be a texture, e.g. "game:block/stone/rock/whitemarble1"`);
       });
     }
     if (e.reflection !== undefined && typeof e.reflection !== "boolean") fail(`${at}: "reflection" must be true or false`);
diff --git a/apps/vsdev/src/moddb/export.ts b/apps/vsdev/src/moddb/export.ts
index 60f8a7c..d50046a 100644
--- a/apps/vsdev/src/moddb/export.ts
+++ b/apps/vsdev/src/moddb/export.ts
@@ -3,6 +3,11 @@
 // no checklist, diffs, warnings, local paths or progress, only what a ModDB page shows (description, screenshots, tags, side, links,
 // releases with changelogs and game versions) plus a Download button and the `vsdev mod install <id> --source <site>` command.
 //
+// Where each part comes from: what the ModDB page manages (name, description, tags, links, logo, screenshots, changelogs) from
+// moddb/<modid>/; everything else from the newest zip in Releases/, the source of truth for the mod itself: its version, game version,
+// dependencies, side (modinfo.json, what the game enforces) and download. The zip also fills what the page leaves empty: its modicon.png
+// is the logo when page.json names none, and its modinfo.json description stands in for a missing description.html.
+//
 // Output (all links relative, so it works under a Pages subpath like https://you.github.io/repo/):
 //   index.html                 every mod, as cards
 //   <modid>/index.html         the mod's page
@@ -13,12 +18,13 @@
 // The game's own one-click install (vintagestorymodinstall://) only installs what ModDB knows, so it can't be offered for these.
 import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
 import path from "node:path";
-import { modInfoFromZip, parseModInfo } from "../mods/modinfo.js";
+import { modIconFromZip, modInfoFromZip, parseModInfo } from "../mods/modinfo.js";
 import { sha256, type SourceIndexFile, type SourceMod, type SourceRelease } from "../mods/source.js";
 import { compareTriple, parseTriple } from "./checks.js";
 import { DESCRIPTION, IMAGES_DIR, PAGE_JSON, PLACEHOLDER, readLocal, releaseHtmlPath } from "./files.js";
 import type { LiveClient, LiveMod } from "./live.js";
 import type { ReleaseZip } from "./releases.js";
+import { sideOf } from "./scaffold.js";
 
 export interface ExportOptions {
   pagesDir: string;
@@ -55,6 +61,8 @@ interface PageData {
   checked: boolean;
 }
 
+/** The file name the zip's modicon.png gets in <modid>/images/ (distinct from page.json's logo.<ext>). */
+const ZIP_ICON = "modicon.png";
 const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
 const sideLabel: Record<string, string> = { both: "Client and server", client: "Client only", server: "Server only" };
 const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
@@ -110,12 +118,20 @@ export async function exportSite(o: ExportOptions): Promise<ExportResult> {
       copyFileSync(from, path.join(outMod, IMAGES_DIR, path.basename(name)));
       return path.basename(name);
     };
-    const logo = copyImage(typeof page.logo === "string" ? page.logo : null);
+    const zip = o.zips.get(modid);
+    // No logo on the page: the zip's own icon.
+    const zipIcon = () => {
+      const icon = zip ? modIconFromZip(zip.path) : undefined;
+      if (!icon) return null;
+      mkdirSync(path.join(outMod, IMAGES_DIR), { recursive: true });
+      writeFileSync(path.join(outMod, IMAGES_DIR, ZIP_ICON), icon);
+      return ZIP_ICON;
+    };
+    const logo = copyImage(typeof page.logo === "string" ? page.logo : null) ?? zipIcon();
     const screenshots = (Array.isArray(page.screenshots) ? page.screenshots : []).map((s) => copyImage(String(s))).filter((s): s is string => !!s);
 
     // Releases: every releases/<v>.json, plus the zip's version; newest first.
     const versions = new Set(Object.keys(local).filter((k) => k.startsWith("releases/") && k.endsWith(".json")).map((k) => path.posix.basename(k, ".json")));
-    const zip = o.zips.get(modid);
     if (zip) versions.add(zip.version);
     else warn("no zip in Releases/: the page has nothing to download");
     const key = (v: string) => parseTriple(v) ?? [0, 0, 0];
@@ -154,11 +170,15 @@ export async function exportSite(o: ExportOptions): Promise<ExportResult> {
     for (const [k, label] of [["homepageurl", "Homepage"], ["sourcecodeurl", "Source code"], ["issuetrackerurl", "Issue tracker"], ["wikiurl", "Wiki"], ["trailervideourl", "Trailer"]] as const) {
       if (isUrl(page[k])) links.push({ label, url: page[k] as string });
     }
+    const pageSide = typeof page.side === "string" ? page.side : undefined;
+    const side = zip?.side ? sideOf(zip.side) : pageSide ?? "both";
+    if (pageSide && pageSide !== side) warn(`page.json says side "${pageSide}" but ${zip!.file}'s modinfo.json says "${zip!.side}"; exported as ${side}`);
+    const description = local[DESCRIPTION] ?? (zip?.description?.trim() ? `<p>${esc(zip.description.trim())}</p>` : "");
     const data: PageData = {
       modid, name: typeof page.name === "string" && page.name ? page.name : zip?.name ?? modid,
-      side: typeof page.side === "string" ? page.side : "both", type: typeof page.type === "string" ? page.type : "mod",
+      side, type: typeof page.type === "string" ? page.type : "mod",
       links, tags: Array.isArray(page.tags) ? page.tags.map(String) : [], logo, screenshots,
-      description: local[DESCRIPTION] ?? "", releases, modDbUrl, checked: asked,
+      description, releases, modDbUrl, checked: asked,
     };
     pages.push(data);
     writeFileSync(path.join(outMod, "index.html"), modPage(data, o.title));
diff --git a/apps/vsdev/src/mods/modinfo.ts b/apps/vsdev/src/mods/modinfo.ts
index ce06602..3e77d97 100644
--- a/apps/vsdev/src/mods/modinfo.ts
+++ b/apps/vsdev/src/mods/modinfo.ts
@@ -104,6 +104,11 @@ export function modInfoFromZip(zip: string | Buffer): ZipModInfo {
   return { nestedAt: named.sort((a, b) => a.entryName.split("/").length - b.entryName.split("/").length)[0]?.entryName, hasDll };
 }
 
+/** The root modicon.png of a mod zip (the icon the game shows in its mod list), matched case-insensitively. */
+export function modIconFromZip(zip: string | Buffer): Buffer | undefined {
+  return new AdmZip(zip).getEntries().find((e) => !e.isDirectory && e.entryName.toLowerCase() === "modicon.png")?.getData();
+}
+
 /** The root modinfo.json text of an unpacked mod folder, matched case-insensitively. */
 export function modInfoFromDir(dir: string): string | undefined {
   const name = readdirSync(dir).find((n) => n.toLowerCase() === "modinfo.json");
diff --git a/apps/vsdev/src/render/scene.ts b/apps/vsdev/src/render/scene.ts
index 17a4b5b..d3d884d 100644
--- a/apps/vsdev/src/render/scene.ts
+++ b/apps/vsdev/src/render/scene.ts
@@ -4,6 +4,8 @@
 //   { player: { wear, hold, ... }, at, rotationY }   the seraph body in an animation pose, dressed in worn items (their shapes hang on the
 //                                       body's bones, the body elements they disable are hidden) and holding items in its hands at the
 //                                       game's hand attachment points (`holdInHand`), standing with its feet at `at`.
+// Either kind takes `material`: one texture (`game:block/stone/rock/whitemarble1`) for every face of the part, worn and held items
+// included, the way a carved statue is drawn: each face keeps its UVs, only the image is swapped.
 import { readFile } from "node:fs/promises";
 import path from "node:path";
 import JSON5 from "json5";
@@ -37,8 +39,8 @@ export type Facing = "north" | "east" | "south" | "west";
 const FACING_DEGREES: Record<Facing, number> = { west: 0, south: 90, east: 180, north: 270 };
 
 export type ScenePartSpec =
-  | { model: string; at?: Vec3; rotationY?: number; scale?: number; animation?: string; frame?: number }
-  | { player: PlayerSpec; at?: Vec3; rotationY?: number; facing?: Facing };
+  | { model: string; at?: Vec3; rotationY?: number; scale?: number; animation?: string; frame?: number; material?: string }
+  | { player: PlayerSpec; at?: Vec3; rotationY?: number; facing?: Facing; material?: string };
 
 export interface SceneIo {
   /** Absolute path of an asset by `domain:path` (the game's assets or a mod); `.json` may be missing. Undefined when not found. */
@@ -127,8 +129,11 @@ export async function buildScene(parts: ScenePartSpec[], io: SceneIo): Promise<S
   const out: SceneResult = { boxes: [], textures: {}, warnings: [] };
   let n = 0;
 
-  /** Loads a shape file and its textures (the shape's own, with `override` keys laid over them), prefixed so keys don't collide. */
-  async function load(ref: string, override: Record<string, string> = {}): Promise<{ shape: CompactShape; raw: Record<string, unknown> } | undefined> {
+  /**
+   * Loads a shape file and its textures (the shape's own, with `override` keys laid over them), prefixed so keys don't collide. With a
+   * `material`, every texture key the shape declares or its faces use is that one texture instead.
+   */
+  async function load(ref: string, override: Record<string, string> = {}, material?: string): Promise<{ shape: CompactShape; raw: Record<string, unknown> } | undefined> {
     const file = io.findFile(ref);
     if (!file) {
       out.warnings.push(`shape ${ref} not found`);
@@ -136,6 +141,7 @@ export async function buildScene(parts: ScenePartSpec[], io: SceneIo): Promise<S
     }
     const raw = JSON5.parse(Buffer.from(await readFile(file)).toString("utf8")) as Record<string, unknown>;
     raw.textures = { ...((raw.textures as Record<string, string>) ?? {}), ...override };
+    if (material) raw.textures = Object.fromEntries([...new Set([...Object.keys(raw.textures as object), ...faceTextureKeys(raw.elements)])].map((k) => [k, material]));
     const prefix = `p${n++}:`;
     const textured = !!io.gameAssets;
     const shape = isolate(compactShape(raw, { faces: textured }), prefix);
@@ -148,7 +154,7 @@ export async function buildScene(parts: ScenePartSpec[], io: SceneIo): Promise<S
   }
 
   /** Shape ref of a collectible: its own domain first, then the vanilla ones. */
-  async function loadCollectible(c: Collectible): Promise<{ shape: CompactShape; raw: Record<string, unknown> } | undefined> {
+  async function loadCollectible(c: Collectible, material?: string): Promise<{ shape: CompactShape; raw: Record<string, unknown> } | undefined> {
     const s = shapeRef(c);
     if (!s) {
       out.warnings.push(`${c.code} has no shape`);
@@ -156,7 +162,7 @@ export async function buildScene(parts: ScenePartSpec[], io: SceneIo): Promise<S
     }
     const refs = [...new Set([c.domain, "game", "survival", "creative"])].map((d) => `${d}:shapes/${s.path}`);
     const ref = refs.find((r) => io.findFile(r)) ?? refs[0];
-    return load(ref, textureRefs(c));
+    return load(ref, textureRefs(c), material);
   }
 
   const lookup = (code: string): Collectible | undefined => {
@@ -173,7 +179,7 @@ export async function buildScene(parts: ScenePartSpec[], io: SceneIo): Promise<S
 
   for (const part of parts) {
     if ("model" in part) {
-      const loaded = await load(part.model);
+      const loaded = await load(part.model, {}, part.material);
       if (!loaded) continue;
       const animation = loaded.shape.animations?.find((a) => a.code === part.animation);
       const boxes = shapeToBoxes(loaded.shape, animation ? samplePose(animation, part.frame ?? 0) : undefined);
@@ -185,13 +191,13 @@ export async function buildScene(parts: ScenePartSpec[], io: SceneIo): Promise<S
     const spec = part.player;
     const worn = (spec.wear ?? []).map(lookup);
     const hair: Record<string, string> = spec.hair ? { hair: `game:entity/humanoid/seraphskinparts/hair/${spec.hair}` } : {};
-    const body = await load(BODY_SHAPE, hair);
+    const body = await load(BODY_SHAPE, hair, part.material);
     if (!body) continue;
     const pieces: CompactShape[] = [];
     const hidden = new Set<string>();
     for (const c of worn) {
       if (!c) continue;
-      const piece = await loadCollectible(c);
+      const piece = await loadCollectible(c, part.material);
       if (piece) pieces.push(piece.shape);
       for (const name of disabledElements(c)) hidden.add(name);
     }
@@ -213,7 +219,7 @@ export async function buildScene(parts: ScenePartSpec[], io: SceneIo): Promise<S
       if (!code) continue;
       const c = lookup(code);
       const anchor = elementFrame(dressed, anchorName, pose);
-      const item = c && anchor ? await loadCollectible(c) : undefined;
+      const item = c && anchor ? await loadCollectible(c, part.material) : undefined;
       if (!c || !item) continue;
       if (!anchor) {
         out.warnings.push(`the player body has no ${anchorName}`);
@@ -232,6 +238,17 @@ export async function buildScene(parts: ScenePartSpec[], io: SceneIo): Promise<S
   return out;
 }
 
+/** Every texture key (without its `#`) the faces of a raw shape's elements use, children included. */
+function faceTextureKeys(elements: unknown, out = new Set<string>()): Set<string> {
+  for (const el of (Array.isArray(elements) ? elements : []) as Record<string, unknown>[]) {
+    for (const face of Object.values((el.faces as Record<string, { texture?: unknown }> | undefined) ?? {})) {
+      if (typeof face?.texture === "string") out.add(face.texture.replace(/^#/, ""));
+    }
+    faceTextureKeys(el.children, out);
+  }
+  return out;
+}
+
 /** An attachment point (`RightHand`...) of a raw shape: position in 1/16 units and rotation in degrees. */
 function attachmentPoint(raw: Record<string, unknown>, code: string): { pos: Vec3; rot: Vec3 } | undefined {
   const visit = (els: unknown): { pos: Vec3; rot: Vec3 } | undefined => {
diff --git a/apps/vsdev/test/moddb.test.ts b/apps/vsdev/test/moddb.test.ts
index 88fb26c..a858003 100644
--- a/apps/vsdev/test/moddb.test.ts
+++ b/apps/vsdev/test/moddb.test.ts
@@ -402,6 +402,33 @@ test("export: a public site with the zips and mods.json, no dev information, saf
   }
 });
 
+test("export: Releases/ is the truth for the mod itself (side, icon, description fallback); moddb/ for what the page manages", async () => {
+  const dir = tmp("export-zip");
+  try {
+    const releases = path.join(dir, "Releases"), pages = path.join(dir, "moddb");
+    modZip(releases, "srv_1.22.7_1.0.0.zip", '{"modid":"srv","version":"1.0.0","name":"Srv","side":"Server","description":"Logs <things>"}', { "modicon.png": "ICON" });
+    modZip(releases, "paged_1.22.7_1.0.0.zip", '{"modid":"paged","version":"1.0.0","name":"P","side":"Client"}', { "modicon.png": "ICON" });
+    seed(path.join(pages, "paged"));
+    const pagedJson = path.join(pages, "paged", "page.json");
+    writeFileSync(pagedJson, JSON.stringify({ ...JSON.parse(readFileSync(pagedJson, "utf8")), side: "both" }));
+    const out = path.join(dir, "site");
+    const result = await exportSite({ pagesDir: pages, outDir: out, modids: ["paged", "srv"], zips: localMods(releases), client: null });
+
+    // No moddb/srv/ at all: name, side, description and logo all come from the zip.
+    assert.equal(readFileSync(path.join(out, "srv", "images", "modicon.png"), "utf8"), "ICON");
+    const srv = readFileSync(path.join(out, "srv", "index.html"), "utf8");
+    assert.ok(srv.includes("<h1>Srv</h1>") && srv.includes("Server only") && srv.includes("<p>Logs &lt;things&gt;</p>") && srv.includes('src="images/modicon.png"'));
+
+    // A page with its own logo keeps it; the side still follows the zip, with a warning about the disagreement.
+    assert.ok(!existsSync(path.join(out, "paged", "images", "modicon.png")), "page.json's logo wins over the zip icon");
+    assert.ok(readFileSync(path.join(out, "paged", "index.html"), "utf8").includes("Client only"));
+    assert.ok(result.warnings.some((w) => w.startsWith("paged:") && w.includes('side "both"') && w.includes('"Client"')));
+    assert.ok(readFileSync(path.join(out, "index.html"), "utf8").includes('src="srv/images/modicon.png"'), "the card uses the zip icon");
+  } finally {
+    rmSync(dir, { recursive: true, force: true });
+  }
+});
+
 test("--source: installs from a site's mods.json, checks the sha256, other mods still from ModDB", async () => {
   const zip = (modinfo: object) => {
     const z = new AdmZip();
diff --git a/apps/vsdev/test/scene.test.ts b/apps/vsdev/test/scene.test.ts
index 7e34349..b244cdf 100644
--- a/apps/vsdev/test/scene.test.ts
+++ b/apps/vsdev/test/scene.test.ts
@@ -1,12 +1,13 @@
 // The pure parts of scenes (`vsdev screenshots` "scene"): moving boxes, the hand placement, element frames, and the type lookup helpers.
 import assert from "node:assert/strict";
-import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
+import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
 import { tmpdir } from "node:os";
 import path from "node:path";
 import { test } from "node:test";
 import { compactShape, elementFrame, holdInHand, rotationMatrix, shapeToBoxes, transformBoxes, ITEM_HAND_TRANSFORM } from "@nf3t/vs-schematic/shapeBoxes.js";
 import { byType, disabledElements, fill, findCollectible, handTransform, shapeRef, textureRefs } from "../src/render/collectible.js";
 import { readShots } from "../src/commands/screenshots.js";
+import { buildScene } from "../src/render/scene.js";
 
 const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
 
@@ -80,3 +81,34 @@ test("screenshots: scene entries are checked", () => {
   assert.throws(() => readShots({ screenshots: [{ name: "s", scene: [{ player: {}, facing: "up" }] }] }, "m.json"), /facing/);
   assert.throws(() => readShots({ screenshots: [{ name: "s", model: "m", scene: [{ model: "m" }] }] }, "m.json"), /exactly one/);
 });
+
+test("buildScene: a part's material replaces every texture, declared or only used by a face", async () => {
+  const dir = mkdtempSync(path.join(tmpdir(), "vsdev-scene-material-"));
+  try {
+    const assets = path.join(dir, "assets");
+    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
+    for (const domain of ["game", "survival"]) {
+      mkdirSync(path.join(assets, domain, "textures", "block"), { recursive: true });
+      writeFileSync(path.join(assets, domain, "textures", "block", "marble.png"), png);
+    }
+    const shapeFile = path.join(dir, "thing.json");
+    writeFileSync(shapeFile, JSON.stringify({
+      textures: { a: "block/missing-a" },
+      elements: [{ name: "x", from: [0, 0, 0], to: [1, 1, 1], faces: { north: { texture: "#a", uv: [0, 0, 1, 1] }, south: { texture: "#b", uv: [0, 0, 1, 1] } } }],
+    }));
+    const io = {
+      findFile: (ref: string) => (ref === shapeFile ? shapeFile : undefined),
+      gameAssets: assets,
+      read: async (file: string) => { try { return new Uint8Array(readFileSync(file)); } catch { return undefined; } },
+    };
+    const plain = await buildScene([{ model: shapeFile }], io);
+    assert.ok(plain.warnings.some((w) => w.includes("missing-a")), "without a material the shape's own texture is looked up");
+    const statue = await buildScene([{ model: shapeFile, material: "game:block/marble" }], io);
+    assert.deepEqual(statue.warnings, []);
+    const urls = Object.values(statue.textures);
+    assert.equal(urls.length, 2, "both keys, also #b that only a face names");
+    assert.equal(new Set(urls).size, 1, "all the same image");
+  } finally {
+    rmSync(dir, { recursive: true, force: true });
+  }
+});
diff --git a/vs-manifest.schema.json b/vs-manifest.schema.json
index d92b018..172f7e1 100644
--- a/vs-manifest.schema.json
+++ b/vs-manifest.schema.json
@@ -159,7 +159,8 @@
                 "rotationY": { "type": "number", "description": "Turn about the vertical axis in degrees, counter-clockwise seen from above (a player at 0 looks west)." },
                 "scale": { "type": "number", "exclusiveMinimum": 0, "description": "Model only: uniform scale." },
                 "animation": { "type": "string", "description": "Model only: an animation of the model, held at `frame`." },
-                "frame": { "type": "number", "minimum": 0 }
+                "frame": { "type": "number", "minimum": 0 },
+                "material": { "type": "string", "description": "One texture for every face of this part, worn and held items included, e.g. \"game:block/stone/rock/whitemarble1\" for a marble statue. Faces keep their UVs; only the image changes." }
               }
             }
           },
```

</details>
