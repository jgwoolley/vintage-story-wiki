// `vsdev search` (against a fake wiki index) and the vs-manifest.json requirements-file half of `vsdev manifest freeze`.
import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runManifest } from "../src/commands/manifest.js";
import { runSearch } from "../src/commands/search.js";
import { DEFAULT_WIKI_URL, resolveWikiUrl, type LocationEnv } from "../src/locations.js";
import { mergePins, modSourceDirs, pinsFromModsFolder, pinsFromReleases, readManifestMods, writeManifestMods } from "../src/manifest/edit.js";
import { fetchWikiIndex, searchWiki } from "../src/wiki/search.js";

const tmp = (name: string) => mkdtempSync(path.join(tmpdir(), `vsdev-${name}-`));
const modZip = (file: string, modid: string, version: string) => {
  const zip = new AdmZip();
  zip.addFile("modinfo.json", Buffer.from(JSON.stringify({ type: "content", modid, name: modid, version })));
  zip.writeZip(file);
};

const INDEX = [
  ["Copper ingot", "items/game/ingot-copper/", "Item", "ingot-copper"],
  ["Copper", "items/game/metalplate-copper/", "Item", "metalplate-copper"],
  ["Bronze ingot", "items/game/ingot-tinbronze/", "Item", "ingot-tinbronze"],
  ["Wolf", "creatures/game/wolf/", "Creature", "wolf-male"],
  ["Ruins", "structures/ruins/", "Structure", "ruins"],
];
const wikiFetch = ((url: string) => Promise.resolve(String(url).endsWith("/assets/searchIndex.json") ? new Response(JSON.stringify(INDEX)) : new Response("", { status: 404 }))) as typeof fetch;

test("search: the page's ranking, kinds, phrases and addresses", async () => {
  const rows = await fetchWikiIndex("https://wiki.test/x/", wikiFetch);
  assert.equal(rows.length, 5);
  const hits = searchWiki(rows, "copper", "https://wiki.test/x/");
  assert.deepEqual(hits.map((h) => h.title), ["Copper", "Copper ingot"], "a title that starts with it, shorter first");
  assert.equal(hits[0].url, "https://wiki.test/x/en/items/game/metalplate-copper/");
  assert.deepEqual(searchWiki(rows, "ingot", "https://wiki.test/x/").map((h) => h.title), ["Bronze ingot", "Copper ingot"].sort((a, b) => a.length - b.length || a.localeCompare(b)), "a later word ranks below a prefix, ties shortest then alphabetical");
  assert.deepEqual(searchWiki(rows, "wolf-male", "https://wiki.test/x/").map((h) => h.title), ["Wolf"], "the code matches too");
  assert.deepEqual(searchWiki(rows, "ingot bronze", "https://wiki.test/x/").map((h) => h.title), ["Bronze ingot"], "all words, in any order");
  assert.deepEqual(searchWiki(rows, "copper", "https://wiki.test/x/", { kind: "creature" }), []);
  assert.deepEqual(searchWiki(rows, "r", "https://wiki.test/x/", { limit: 1 }).length, 1);
  await assert.rejects(fetchWikiIndex("https://wiki.test/x/", (async () => new Response("", { status: 404 })) as typeof fetch), /HTTP 404.*prodWikiUrl/);
});

test("search: the wiki address follows flag, env, vs-manifest.json, then the built-in one", () => {
  const e = (extra: Partial<LocationEnv> = {}): LocationEnv => ({ cwd: "/w", env: {}, home: "/h", platform: "linux", config: null, ...extra });
  const config = { file: "/w/vs-manifest.json", dir: "/w", wikiUrl: "https://mine.test/wiki" };
  assert.equal(resolveWikiUrl(undefined, e()).path, DEFAULT_WIKI_URL);
  assert.equal(resolveWikiUrl(undefined, e({ config })).path, "https://mine.test/wiki/", "a trailing slash is added");
  assert.equal(resolveWikiUrl(undefined, e({ config, env: { VSDEV_WIKI_URL: "https://env.test/" } })).path, "https://env.test/");
  assert.equal(resolveWikiUrl("https://flag.test", e({ config, env: { VSDEV_WIKI_URL: "https://env.test/" } })).path, "https://flag.test/");
});

test("search command: results, no match, bad kind", async () => {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    assert.equal(await runSearch(["copper", "--wiki", "https://wiki.test/", "--json"], wikiFetch), 0);
    const out = JSON.parse(lines.pop()!);
    assert.equal(out.results[0].title, "Copper");
    assert.equal(await runSearch(["zzz", "--wiki", "https://wiki.test/"], wikiFetch), 1);
    await assert.rejects(runSearch(["copper", "--kind", "Nope", "--wiki", "https://wiki.test/"], wikiFetch), /no such kind 'Nope'.*Creature/);
  } finally {
    console.log = log;
  }
});

test("manifest freeze: folders pin the newest version, the list merges, other keys survive", () => {
  const dir = tmp("freeze");
  try {
    const mods = path.join(dir, "Mods");
    mkdirSync(mods);
    modZip(path.join(mods, "a_1.0.0.zip"), "alpha", "1.0.0");
    modZip(path.join(mods, "a_1.2.0.zip"), "alpha", "1.2.0");
    modZip(path.join(mods, "b.zip"), "Beta", "2.0.0");
    writeFileSync(path.join(mods, "broken.zip"), "not a zip");
    const { pins, skipped } = pinsFromModsFolder(mods);
    assert.deepEqual(pins, [{ modid: "alpha", version: "1.2.0" }, { modid: "beta", version: "2.0.0" }].map((p) => p), "newest copy, modid lowercased by the reader");
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].name, /broken\.zip/);

    const releases = path.join(dir, "Releases");
    mkdirSync(releases);
    modZip(path.join(releases, "mymod_1.22.7_0.1.0.zip"), "mymod", "0.1.0");
    modZip(path.join(releases, "mymod_1.22.7_0.2.0.zip"), "mymod", "0.2.0");
    assert.deepEqual(pinsFromReleases(releases).pins, [{ modid: "mymod", version: "0.2.0" }]);

    const existing = [{ modid: "Alpha", version: "1.0.0" }, { modid: "gone", version: "9.9.9" }, { modid: "beta" }];
    const merged = mergePins(existing, [...pins, { modid: "zed", version: "3.0.0" }]);
    assert.deepEqual(merged.mods, [{ modid: "Alpha", version: "1.2.0" }, { modid: "gone", version: "9.9.9" }, { modid: "beta", version: "2.0.0" }, { modid: "zed", version: "3.0.0" }]);
    assert.deepEqual(merged.changes.map((c) => c.action), ["update", "update", "add"], "'gone' is untouched without --prune");
    const pruned = mergePins(existing, pins, true);
    assert.deepEqual(pruned.mods.map((m) => m.modid), ["Alpha", "beta"]);
    assert.ok(pruned.changes.some((c) => c.action === "remove" && c.modid === "gone"));

    const manifest = path.join(dir, "vs-manifest.json");
    writeFileSync(manifest, JSON.stringify({ serverVersion: "1.22.7", wikiIncludeItems: ["game:*"], mods: [{ modid: "alpha", version: "1.0.0" }] }));
    writeManifestMods(manifest, merged.mods);
    const written = JSON.parse(readFileSync(manifest, "utf8"));
    assert.equal(written.serverVersion, "1.22.7");
    assert.deepEqual(written.wikiIncludeItems, ["game:*"]);
    assert.equal(readManifestMods(manifest).length, 4);
    const withSrc = path.join(dir, "sub", "vs-manifest.json");
    mkdirSync(path.dirname(withSrc));
    writeFileSync(withSrc, JSON.stringify({ mods: [{ modid: "MyMod", src: "MyModFolder" }, { modid: "other", version: "1" }] }));
    assert.deepEqual([...modSourceDirs(withSrc)], [["mymod", path.join(dir, "sub", "MyModFolder")]], "src maps the modid to its folder");
    const kept = mergePins(readManifestMods(withSrc), [{ modid: "mymod", version: "2.0.0" }]).mods;
    assert.equal(kept[0].src, "MyModFolder", "freeze keeps src");
    assert.deepEqual(readManifestMods(path.join(dir, "missing.json")), [], "a missing file has no mods");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("manifest freeze command: dry run writes nothing, -y writes, a new file is created", async () => {
  const dir = tmp("freezecmd");
  const cwd = process.cwd();
  const log = console.log;
  console.log = () => {};
  const prevInit = process.env.INIT_CWD;
  try {
    mkdirSync(path.join(dir, "Mods"));
    modZip(path.join(dir, "Mods", "a.zip"), "alpha", "1.0.0");
    process.env.INIT_CWD = dir;
    process.chdir(dir);
    assert.equal(await runManifest(["freeze", "--dry-run"]), 0);
    assert.throws(() => readFileSync(path.join(dir, "vs-manifest.json")), "dry run writes nothing");
    assert.equal(await runManifest(["freeze", "-y"]), 0);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "vs-manifest.json"), "utf8")), { mods: [{ modid: "alpha", version: "1.0.0" }] });
    assert.equal(await runManifest(["freeze", "-y"]), 0, "nothing to change the second time");
    await assert.rejects(runManifest(["freeze", "--from", "disk"]), /--from must be/);
  } finally {
    console.log = log;
    process.chdir(cwd);
    if (prevInit === undefined) delete process.env.INIT_CWD;
    else process.env.INIT_CWD = prevInit;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("screenshots: entries are checked, and domain:path schematics are found in the game, Mods folders and zips", async () => {
  const { findAsset, isAssetRef, readShots } = await import("../src/commands/screenshots.js");
  assert.deepEqual(readShots({}, "m.json"), []);
  const ok = readShots({ screenshots: [{ name: "a", schematic: "x:y.json", view: [1, 0.5, 1] }, { name: "b", schematic: "s.json", view: "top" }] }, "m.json");
  assert.equal(ok.length, 2);
  assert.throws(() => readShots({ screenshots: [{ name: "a/b", schematic: "s" }] }, "m.json"), /name/);
  assert.throws(() => readShots({ screenshots: [{ name: "a", schematic: "s" }, { name: "a", schematic: "t" }] }, "m.json"), /twice/);
  assert.throws(() => readShots({ screenshots: [{ name: "a", schematic: "s", view: "sideways" }] }, "m.json"), /view/);
  assert.throws(() => readShots({ screenshots: [{ name: "a", schematic: "s", view: [0, 0, 0] }] }, "m.json"), /view/);
  assert.throws(() => readShots({ screenshots: [{ name: "a", schematic: "s", size: 10 }] }, "m.json"), /size/);
  assert.throws(() => readShots({ screenshots: [{ name: "a" }] }, "m.json"), /exactly one/);
  assert.throws(() => readShots({ screenshots: [{ name: "a", schematic: "s", model: "m" }] }, "m.json"), /exactly one/);
  assert.throws(() => readShots({ screenshots: [{ name: "a", model: "m", logoAt: "middle" }] }, "m.json"), /logoAt/);
  assert.throws(() => readShots({ screenshots: [{ name: "a", model: "m", preset: "huge" }] }, "m.json"), /preset/);
  assert.throws(() => readShots({ screenshots: [{ name: "a", model: "m", safe: { bottom: 1 } }] }, "m.json"), /safe/);
  assert.equal(readShots({ screenshots: [{ name: "icon", logo: "l.svg", preset: "modicon" }] }, "m.json").length, 1, "a logo alone is an icon");
  assert.equal(readShots({ screenshots: [{ name: "a", model: "m", title: "T", logo: "l.svg", textAt: "bottom-left", height: 1080 }] }, "m.json").length, 1);
  assert.ok(isAssetRef("betterruins:schematics/a.json"));
  assert.ok(!isAssetRef("C:\\x\\a.json") && !isAssetRef("schematics/a.json"));

  const dir = tmp("shots");
  try {
    const game = path.join(dir, "game");
    mkdirSync(path.join(game, "assets/survival/schematics"), { recursive: true });
    writeFileSync(path.join(game, "assets/survival/schematics/vanilla.json"), "{}");
    const mods = path.join(dir, "Mods");
    mkdirSync(mods);
    const zip = new AdmZip();
    zip.addFile("assets/modx/schematics/inzip.json", Buffer.from("{}"));
    zip.writeZip(path.join(mods, "modx.zip"));
    mkdirSync(path.join(mods, "folder/assets/mody/s"), { recursive: true });
    writeFileSync(path.join(mods, "folder/assets/mody/s/infolder.json.gz"), "");
    const t = path.join(dir, "tmp");
    mkdirSync(t);
    assert.match(findAsset("survival:schematics/vanilla", game, mods, t)!.from, /game/, "a missing .json is added");
    assert.match(findAsset("modx:schematics/inzip.json", game, mods, t)!.from, /modx\.zip/);
    assert.match(findAsset("mody:s/infolder", game, mods, t)!.from, /folder/);
    assert.equal(findAsset("modx:nope.json", game, mods, t), undefined);
    assert.equal(findAsset("modx:../../etc/passwd", game, mods, t), undefined, "no path escapes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
