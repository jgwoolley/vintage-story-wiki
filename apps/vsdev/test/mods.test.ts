// vsdev's ModDB, mod-folder and game-download code, offline: ModDB is a fake fetch serving hand-built listings and zips (adm-zip),
// the game tarball is built with tar. Expected behaviour is the game's (vsapi GameVersion/SemVer/ModInfo, ModDbUtil, ModLoader) and
// the ported tools' (vs-mod-updater, ModDbCli's check).
import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import * as tar from "tar";
import { parseGameArgs } from "../src/commands/game.js";
import { planLine } from "../src/commands/mod.js";
import { installServer, planGameInstall } from "../src/game/download.js";
import { checkReleases, writeGitHubOutputs } from "../src/moddb/check.js";
import { versionWarnings } from "../src/moddb/checks.js";
import { readReleaseZip } from "../src/moddb/releases.js";
import { gameInfo, readGameMarker, type LocationEnv } from "../src/locations.js";
import { extractZip } from "../src/mods/extract.js";
import { applyInstallPlan, checkUpdates, resolveInstallPlan } from "../src/mods/install.js";
import { installedIndex, scanLocalMods } from "../src/mods/local.js";
import { blockReason, latestStableGameVersion, ModDb, parseModSpec, rankSearch, type InstallInfo, type ModDbMod } from "../src/mods/moddb.js";
import { modDependencies, modInfoFromZip, parseModInfo, toModId } from "../src/mods/modinfo.js";
import { compareGameVersions, satisfiesMinimum, splitGameVersion } from "../src/mods/versions.js";

const tmp = (name: string) => mkdtempSync(path.join(tmpdir(), `vsdev-${name}-`));

test("versions: the game's ordering and the dependency minimum check", () => {
  assert.deepEqual(splitGameVersion("1.17"), [1, 17, 0, 3], "a missing patch is 0; no suffix is stable (3)");
  assert.deepEqual(splitGameVersion("1.17-pre.1"), [1, 17, 0, 1, 1]);
  assert.deepEqual(splitGameVersion("1.0.0-rc.2"), [1, 0, 0, 2, 2]);
  assert.deepEqual(splitGameVersion("2.0.0-dev.17"), [2, 0, 0, 0, 17]);
  assert.equal(compareGameVersions("1.17", "1.17.0"), 0);
  assert.equal(compareGameVersions("1.0.0", "1.0.0-rc.2"), 1, "a release is newer than its release candidate");
  assert.equal(compareGameVersions("1.0.0-rc.1", "1.0.0-pre.9"), 1, "rc > pre");
  assert.equal(compareGameVersions("1.10.0", "1.9.9"), 1, "numeric, not text");
  assert.equal(compareGameVersions("2.0.0-dev.9", "2.0.0-dev.17"), -1);

  assert.ok(satisfiesMinimum("", "0.1.0"), "empty minimum = any");
  assert.ok(satisfiesMinimum("*", "0.1.0"));
  assert.ok(satisfiesMinimum("1.2.0", "1.2.0"));
  assert.ok(satisfiesMinimum("1.2", "1.2.1"), "a short minimum is padded");
  assert.ok(!satisfiesMinimum("1.3.0", "1.2.9"));
  assert.ok(satisfiesMinimum("2.0.0-dev.22", "2.0.0-dev.28"), "numeric pre-release identifiers compare as numbers");
  assert.ok(!satisfiesMinimum("2.0.0", "2.0.0-dev.28"), "a pre-release is below its release");
});

test("specs, search ranking, blocklist and game versions", () => {
  assert.deepEqual(parseModSpec("carryon"), { id: "carryon", version: undefined });
  assert.deepEqual(parseModSpec("carryon@1.2.3"), { id: "carryon", version: "1.2.3" });
  assert.deepEqual(parseModSpec("carryon:1.2.3-rc.1"), { id: "carryon", version: "1.2.3-rc.1" }, "vs-manifest's older form");
  const blocked = new Map([["badmod", "malware"], ["oldmod@1.0.1", "vulnerable"]]);
  assert.equal(blockReason(blocked, "badmod", "9.9.9"), "malware", "a bare id blocks every version");
  assert.equal(blockReason(blocked, "oldmod", "1.0.1"), "vulnerable");
  assert.equal(blockReason(blocked, "oldmod", "1.0.2"), undefined);
  assert.equal(blockReason(null, "badmod"), undefined, "no list (couldn't fetch) blocks nothing, as the game goes on");
  assert.equal(latestStableGameVersion(["1.21.6", "v1.22.7", "1.22.8-rc.1", "1.9.9"]), "1.22.7");
  const hits = [
    { name: "Carry Things", summary: "", modidstrs: ["carrythings"], downloads: 10 },
    { name: "Backpacks", summary: "carry more", modidstrs: ["backpacks"], downloads: 999 },
    { name: "Carry On", summary: "", modidstrs: ["carryon"], downloads: 5 },
    { name: "Other", summary: "", modidstrs: ["other"], downloads: 9999 },
  ];
  assert.deepEqual(rankSearch(hits, "carryon").map((h) => h.name), ["Carry On", "Other", "Backpacks", "Carry Things"], "an exact modid first, the rest by downloads");
  assert.deepEqual(rankSearch(hits, "carry").map((h) => h.name), ["Carry Things", "Carry On", "Backpacks", "Other"], "name matches, then summary, then the rest");
});

test("modinfo.json: lenient JSON, case-insensitive keys, modid from the name, game deps skipped", () => {
  const info = parseModInfo(`﻿{
    // comment
    Type: 'code', "Name": "My Cool-Mod 2", "Version": "1.0.0",
    "Website": "http://example.com/a//b", /* block */
    "Dependencies": { "game": "1.22.0", "survival": "", "xlib": "0.3.0", "Bad-Id": "" },
  }`);
  assert.equal(info.modid, "mycoolmod2");
  assert.equal(info.modidFromName, true);
  assert.equal(info.version, "1.0.0");
  assert.equal(info.type, "code");
  assert.deepEqual(modDependencies(info).map((d) => d.modid), ["xlib", "Bad-Id"]);
  assert.match(info.problems.join(), /Bad-Id/);
  assert.equal(toModId("9lives"), undefined, "the game refuses a name starting with a digit");
});

/** A mod zip with a modinfo.json (and optional extra files). */
function modZip(info: Record<string, unknown> | null, extra: Record<string, string> = {}, at = "modinfo.json"): Buffer {
  const zip = new AdmZip();
  if (info) zip.addFile(at, Buffer.from(JSON.stringify(info)));
  for (const [name, text] of Object.entries(extra)) zip.addFile(name, Buffer.from(text));
  return zip.toBuffer();
}

test("a Mods folder is read the way the game reads it", () => {
  const dir = tmp("scan");
  try {
    writeFileSync(path.join(dir, "a.zip"), modZip({ modid: "alpha", version: "1.0.0" }));
    writeFileSync(path.join(dir, "a-new.zip"), modZip({ modid: "alpha", version: "1.2.0" }));
    writeFileSync(path.join(dir, "nested.zip"), modZip({ modid: "nested", version: "1.0.0" }, {}, "nested/modinfo.json"));
    writeFileSync(path.join(dir, "code.zip"), modZip(null, { "code.dll": "MZ" }));
    writeFileSync(path.join(dir, "loose.dll"), "MZ");
    writeFileSync(path.join(dir, "readme.txt"), "not a mod");
    mkdirSync(path.join(dir, "folder"));
    writeFileSync(path.join(dir, "folder", "ModInfo.json"), JSON.stringify({ name: "Folder Mod", version: "0.1.0" }));
    const mods = scanLocalMods(dir);
    assert.deepEqual(mods.map((m) => m.source), ["a-new.zip", "a.zip", "code.zip", "folder", "loose.dll", "nested.zip"], "readme.txt isn't a mod");
    const by = Object.fromEntries(mods.map((m) => [m.source, m]));
    assert.match(by["nested.zip"].error!, /not the zip's root/);
    assert.match(by["code.zip"].error!, /code mod/);
    assert.match(by["loose.dll"].error!, /code-only/);
    assert.equal(by.folder.info?.modid, "foldermod");
    const index = installedIndex(mods);
    assert.deepEqual(index.get("alpha")!.map((m) => m.info!.version), ["1.2.0", "1.0.0"], "highest first, the copy the game loads");
    assert.equal(modInfoFromZip(modZip({ modid: "x" }, {}, "MODINFO.JSON")).text !== undefined, true, "root name matched case-insensitively");

  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fake ModDB: listings, install-information answers (per "id" or "id@version"), zips by fileUrl, and a blocklist. */
function fakeModDb(spec: {
  mods?: Record<string, Partial<ModDbMod>>;
  install: Record<string, InstallInfo>;
  files?: Record<string, Buffer>;
  blocked?: { id: string; reason: string }[];
}) {
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.host === "cdn.vintagestory.at") return spec.blocked ? json(spec.blocked) : new Response("", { status: 404 });
    if (url.pathname === "/api/v2/mods/install-information") {
      const data: Record<string, InstallInfo> = {};
      for (const s of url.searchParams.get("ids")!.split(",")) data[s.split("@")[0]] = spec.install[s] ?? { errorCode: 4041 };
      return json({ data });
    }
    if (url.pathname.startsWith("/api/mod/")) {
      const mod = spec.mods?.[decodeURIComponent(url.pathname.slice("/api/mod/".length))];
      return json(mod ? { statuscode: "200", mod: { releases: [], ...mod } } : { statuscode: "404" });
    }
    const file = spec.files?.[url.pathname];
    return file ? new Response(new Uint8Array(file)) : new Response("missing", { status: 404 });
  }) as typeof fetch;
  return { db: new ModDb(fakeFetch), calls };
}

test("install: dependencies from modinfo, ModDB's pick, retractions, the blocklist, no downgrades", async () => {
  const { db } = fakeModDb({
    install: {
      app: { fileName: "app_2.0.0.zip", fileUrl: "/download/1/app_2.0.0.zip", recommendedUpgrade: "2.0.0" },
      lib: { fileName: "lib_1.5.0.zip", fileUrl: "/download/2/lib_1.5.0.zip", recommendedUpgrade: "1.5.0" },
      loopy: { fileName: "loopy_1.0.0.zip", fileUrl: "/download/3/loopy_1.0.0.zip", recommendedUpgrade: "1.0.0" },
      gone: { errorCode: 4101, retractionReason: "<p>Broke&nbsp;saves</p>" },
      bad: { fileName: "bad_1.0.1.zip", fileUrl: "/download/5/bad_1.0.1.zip", recommendedUpgrade: "1.0.1" },
      old: { fileName: "old_1.0.0.zip", fileUrl: "/download/6/old_1.0.0.zip", recommendedUpgrade: "1.0.0" },
    },
    files: {
      "/download/1/app_2.0.0.zip": modZip({ modid: "app", name: "App", version: "2.0.0", dependencies: { game: "1.22.0", lib: "1.2.0", loopy: "", missing: "" } }),
      "/download/2/lib_1.5.0.zip": modZip({ modid: "lib", version: "1.5.0", dependencies: { app: "" } }),
      "/download/3/loopy_1.0.0.zip": modZip({ modid: "loopy", version: "1.0.0", dependencies: { loopy: "" } }),
      "/download/5/bad_1.0.1.zip": modZip({ modid: "bad", version: "1.0.1" }),
    },
    mods: { missing: { name: "Missing", releases: [{ modversion: "3.0.0", filename: "m.zip", mainfile: "x", tags: ["1.21.0"] }] } },
    blocked: [{ id: "bad@1.0.1", reason: "vulnerable" }],
  });
  const dir = tmp("install");
  try {
    writeFileSync(path.join(dir, "old_9.0.0.zip"), modZip({ modid: "old", version: "9.0.0" }));
    writeFileSync(path.join(dir, "lib_1.0.0.zip"), modZip({ modid: "lib", version: "1.0.0" }));
    const plan = await resolveInstallPlan(["app", "gone", "bad", "old"].map((spec) => ({ spec })), { db, gameVersion: "1.22.7", installed: installedIndex(scanLocalMods(dir)) });
    const by = Object.fromEntries(plan.map((e) => [e.modid, e]));
    assert.equal(by.app.action, "install");
    assert.equal(by.lib.action, "update", "the installed 1.0.0 is below app's minimum 1.2.0");
    assert.equal(by.lib.requiredBy, "App");
    assert.equal(by.loopy.action, "install", "a dependency on itself doesn't loop");
    assert.match(by.missing.error!, /no release for game version 1\.22\.7 \(newest is 3\.0\.0, for 1\.21\.0\)/);
    assert.match(by.gone.error!, /retracted: Broke saves.*--allow-retracted/);
    assert.match(by.bad.error!, /blocklist: vulnerable/);
    assert.equal(by.old.action, "newer-installed", "never a downgrade");
    assert.equal(plan.filter((e) => e.modid === "app").length, 1, "app (a dependency of lib) is resolved once");
    // picocolors colors output whenever $CI is set (GitHub Actions), so compare the plain text.
    assert.match(stripVTControlCharacters(planLine(by.lib)), /^\[~\] lib\s+1\.0\.0 -> 1\.5\.0\s+\(dependency of App, needs >= 1\.2\.0\)/);

    const applied = await applyInstallPlan(plan, { modsDir: dir, outDir: dir, db });
    assert.deepEqual(applied.map((a) => a.error), [undefined, undefined, undefined]);
    assert.deepEqual(readdirSync(dir).sort(), ["app_2.0.0.zip", "lib_1.5.0.zip", "loopy_1.0.0.zip", "old_9.0.0.zip"], "the old lib zip is gone, nothing else touched");

    const again = await resolveInstallPlan([{ spec: "app" }], { db, gameVersion: "1.22.7", installed: installedIndex(scanLocalMods(dir)) });
    assert.deepEqual(again.map((e) => e.action), ["current", "satisfied", "satisfied", "error"], "installed deps that meet their minimum are left alone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install into a separate output folder leaves the scanned folder alone", async () => {
  const { db } = fakeModDb({
    install: { lib: { fileName: "lib_1.5.0.zip", fileUrl: "/d/lib.zip", recommendedUpgrade: "1.5.0" } },
    files: { "/d/lib.zip": modZip({ modid: "lib", version: "1.5.0" }) },
  });
  const src = tmp("src"), out = tmp("out");
  try {
    writeFileSync(path.join(src, "lib_1.0.0.zip"), modZip({ modid: "lib", version: "1.0.0" }));
    writeFileSync(path.join(out, "lib_1.1.0.zip"), modZip({ modid: "lib", version: "1.1.0" }));
    const plan = await resolveInstallPlan([{ spec: "lib" }], { db, installed: installedIndex(scanLocalMods(src)) });
    await applyInstallPlan(plan, { modsDir: src, outDir: out, db });
    assert.deepEqual(readdirSync(src), ["lib_1.0.0.zip"]);
    assert.deepEqual(readdirSync(out), ["lib_1.5.0.zip"], "the older copy already in the output folder is replaced");
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("a dependency whose minimum is a pre-release gets the newest matching pre-release", async () => {
  const { db, calls } = fakeModDb({
    install: {
      food: { fileName: "food.zip", fileUrl: "/d/food.zip", recommendedUpgrade: "2.0.0" },
      "cook@2.0.0-dev.28": { fileName: "cook.zip", fileUrl: "/d/cook.zip" },
    },
    mods: { cook: { name: "Cook", releases: [
      { modversion: "2.0.0-dev.28", filename: "c28", mainfile: "", tags: ["1.22.7"] },
      { modversion: "2.0.0-dev.20", filename: "c20", mainfile: "", tags: ["1.22.7"] },
    ] } },
    files: {
      "/d/food.zip": modZip({ modid: "food", version: "2.0.0", dependencies: { cook: "2.0.0-dev.22" } }),
      "/d/cook.zip": modZip({ modid: "cook", version: "2.0.0-dev.28" }),
    },
  });
  const plan = await resolveInstallPlan([{ spec: "food" }], { db, gameVersion: "1.22.7", installed: new Map() });
  assert.deepEqual(plan.map((e) => [e.modid, e.action, e.version]), [["food", "install", "2.0.0"], ["cook", "install", "2.0.0-dev.28"]]);
  assert.match(plan[1].warnings[0], /picked pre-release 2\.0\.0-dev\.28/);
  assert.ok(calls.some((c) => c.includes("ids=cook%402.0.0-dev.28")), "the picked version is still checked with ModDB (retractions)");
});

test("update: newer releases, duplicates, ahead-of-ModDB, missing dependencies", async () => {
  const { db } = fakeModDb({
    install: {
      a: { fileName: "a_2.0.0.zip", fileUrl: "/d/a2.zip", recommendedUpgrade: "2.0.0" },
      b: { fileName: "b.zip", fileUrl: "/d/b.zip", recommendedUpgrade: "1.0.0" },
      dep: { fileName: "dep_1.0.0.zip", fileUrl: "/d/dep.zip", recommendedUpgrade: "1.0.0" },
    },
    files: { "/d/a2.zip": modZip({ modid: "a", version: "2.0.0" }), "/d/dep.zip": modZip({ modid: "dep", version: "1.0.0" }) },
  });
  const dir = tmp("update");
  try {
    writeFileSync(path.join(dir, "a1.zip"), modZip({ modid: "a", version: "1.0.0" }));
    writeFileSync(path.join(dir, "a0.zip"), modZip({ modid: "a", version: "0.9.0" }));
    writeFileSync(path.join(dir, "b.zip"), modZip({ modid: "b", version: "1.1.0", dependencies: { dep: "1.0.0" } }));
    const result = await checkUpdates(dir, { db, gameVersion: "1.22.7" });
    const rows = Object.fromEntries(result.rows.map((r) => [r.modid, r]));
    assert.equal(rows.a.status, "update");
    assert.equal(rows.a.installed, "1.0.0", "the highest copy is the one checked");
    assert.deepEqual(rows.a.duplicates, ["a0.zip"]);
    assert.equal(rows.b.status, "ahead");
    assert.deepEqual(result.dependencyPlan.map((e) => [e.modid, e.action]), [["dep", "install"]]);
    await applyInstallPlan([...result.updates, ...result.dependencyPlan], { modsDir: dir, outDir: dir, db });
    assert.deepEqual(readdirSync(dir).sort(), ["a_2.0.0.zip", "b.zip", "dep_1.0.0.zip"], "both old copies of a are gone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extract refuses zip slip", () => {
  const dir = tmp("extract");
  try {
    const good = new AdmZip();
    good.addFile("assets/m/shapes/a.json", Buffer.from("{}"));
    good.addFile("modinfo.json", Buffer.from("{}"));
    assert.equal(extractZip(good.toBuffer(), path.join(dir, "good")), 2);
    assert.ok(existsSync(path.join(dir, "good/assets/m/shapes/a.json")));
    const evil = new AdmZip();
    evil.addFile("ok.txt", Buffer.from("x"));
    evil.addFile("placeholder", Buffer.from("x"));
    evil.getEntries()[1].entryName = "../escaped.txt";
    assert.throws(() => extractZip(evil.toBuffer(), path.join(dir, "evil")), /outside/);
    assert.ok(!existsSync(path.join(dir, "escaped.txt")));
    assert.ok(!existsSync(path.join(dir, "evil/ok.txt")), "nothing is written when any entry escapes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check: ModDbCli's version rules, statuses and GitHub outputs", async () => {
  assert.deepEqual(versionWarnings("1.2.4", ["1.2.3", "1.0.0"]), []);
  assert.deepEqual(versionWarnings("1.3.0", ["1.2.3"]), []);
  assert.deepEqual(versionWarnings("2.0.0", ["1.2.3"]), []);
  assert.deepEqual(versionWarnings("1.2.5", ["1.2.3"]), ["1.2.5 skips version numbers after 1.2.3 (expected one of: 1.2.4, 1.3.0, 2.0.0)"]);
  assert.deepEqual(versionWarnings("1.2.3", ["1.2.3"]), ["1.2.3 is not newer than the newest listed version 1.2.3"]);
  assert.deepEqual(versionWarnings("v1", ["1.0.0"]), ["version 'v1' is not MAJOR.MINOR.PATCH, so the numbering was not checked"]);
  assert.deepEqual(versionWarnings("1.0.0-rc.1", []), [], "nothing listed: nothing to compare");

  const dir = tmp("check");
  try {
    writeFileSync(path.join(dir, "deployed.zip"), modZip({ ModID: "Shipped", version: "1.0.0" }));
    writeFileSync(path.join(dir, "next.zip"), modZip({ modid: "shipped", version: "1.0.2" }));
    writeFileSync(path.join(dir, "brandnew_1.22.7_0.1.0.zip"), modZip(null, { "x.dll": "MZ" }));
    writeFileSync(path.join(dir, "mystery.zip"), modZip(null));
    const fallback = readReleaseZip(path.join(dir, "brandnew_1.22.7_0.1.0.zip"));
    assert.deepEqual([fallback.file, fallback.modid, fallback.version, fallback.gameVersion], ["brandnew_1.22.7_0.1.0.zip", "brandnew", "0.1.0", "1.22.7"], "file-name fallback");
    const db = { mod: async (id: string) => (id === "shipped" ? ({ releases: [{ modversion: "1.0.0" }, { modversion: "0.9.0" }] } as ModDbMod) : null) };
    const rows = await checkReleases(["brandnew_1.22.7_0.1.0.zip", "deployed.zip", "mystery.zip", "next.zip"].map((f) => path.join(dir, f)), db);
    assert.deepEqual(rows.map((r) => [r.file, r.status]), [["brandnew_1.22.7_0.1.0.zip", "new-mod"], ["deployed.zip", "deployed"], ["mystery.zip", "error"], ["next.zip", "new-version"]]);
    assert.match(rows[3].warnings[0], /skips version numbers/);

    const out = path.join(dir, "out"), summary = path.join(dir, "summary");
    const logged: string[] = [];
    writeGitHubOutputs(rows, { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, GITHUB_ACTIONS: "true" }, (l) => logged.push(l));
    assert.equal(readFileSync(out, "utf8"), 'undeployed=["brandnew_1.22.7_0.1.0.zip","next.zip"]\nany_undeployed=true\n');
    assert.match(logged[0], /^::warning title=Version number::next\.zip: /);
    assert.match(readFileSync(summary, "utf8"), /\| next\.zip \| shipped \| 1\.0\.2 \| new-version \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("client download: refused without --accept-client-terms, fetched (flat from its vintagestory/ folder) with it", async () => {
  const dir = tmp("client");
  try {
    const src = path.join(dir, "src", "vintagestory");
    mkdirSync(path.join(src, "assets", "survival", "textures", "block"), { recursive: true });
    writeFileSync(path.join(src, "VintagestoryAPI.dll"), "");
    writeFileSync(path.join(src, "assets", "version-1.22.7.txt"), "");
    writeFileSync(path.join(src, "assets", "survival", "textures", "block", "linen.png"), "png");
    const tgz = path.join(dir, "c.tar.gz");
    await tar.create({ gzip: true, file: tgz, cwd: path.join(dir, "src") }, ["vintagestory"]);
    const data = readFileSync(tgz);
    const requested: string[] = [];
    const fakeFetch = (async (url: string | URL) => (requested.push(String(url)), new Response(new Uint8Array(data)))) as typeof fetch;
    const target = path.join(dir, "game");
    const base = { kind: "client" as const, branch: "stable", version: "1.22.7", dir: target, force: false, fetchImpl: fakeFetch, log: () => {} };
    await assert.rejects(installServer(base), /doesn't download the game client/);
    assert.deepEqual(requested, [], "nothing is requested without the acknowledgement");
    assert.equal(await installServer({ ...base, acceptClientTerms: true }), "downloaded");
    assert.match(requested[0], /\/vs_client_linux-x64_1\.22\.7\.tar\.gz$/);
    assert.deepEqual(gameInfo(target), { kind: "client", version: "1.22.7" });
    assert.equal(readGameMarker(target)?.kind, "client");
    assert.equal(await installServer({ ...base, acceptClientTerms: true }), "skipped-present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("server download: skip, refuse over a client, replace only vsdev's own install; the client is not fetched by default; failures keep the install", async () => {
  const dir = tmp("game");
  try {
    // Fake server tarballs laid out like the real ones (flat, with the API DLL and assets/version-<v>.txt).
    const tarballs = new Map<string, Buffer>();
    for (const version of ["1.22.7", "1.22.6"]) {
      const src = path.join(dir, `src-${version}`);
      mkdirSync(path.join(src, "assets"), { recursive: true });
      writeFileSync(path.join(src, "VintagestoryAPI.dll"), "");
      writeFileSync(path.join(src, "assets", `version-${version}.txt`), "");
      const tgz = path.join(dir, `${version}.tar.gz`);
      await tar.create({ gzip: true, file: tgz, cwd: src }, readdirSync(src));
      tarballs.set(`vs_server_linux-x64_${version}.tar.gz`, readFileSync(tgz));
      rmSync(src, { recursive: true });
      rmSync(tgz);
    }
    const requested: string[] = [];
    const fakeFetch = (async (url: string | URL) => {
      requested.push(String(url));
      const data = tarballs.get(String(url).split("/").pop()!);
      return data ? new Response(new Uint8Array(data), { headers: { "content-length": String(data.length) } }) : new Response("", { status: 404 });
    }) as typeof fetch;
    const quiet = () => {};
    const install = (version: string, at: string, force = false) => installServer({ branch: "stable", version, dir: at, force, fetchImpl: fakeFetch, log: quiet });
    const target = path.join(dir, "vintagestory");

    let progress = 0;
    assert.equal(await installServer({ branch: "stable", version: "1.22.7", dir: target, force: false, fetchImpl: fakeFetch, log: quiet, onProgress: (d: number) => (progress = d) }), "downloaded");
    assert.deepEqual(gameInfo(target), { kind: "server", version: "1.22.7" });
    assert.ok(progress > 0);
    assert.deepEqual([readGameMarker(target)?.kind, readGameMarker(target)?.version], ["server", "1.22.7"]);
    assert.equal(await install("1.22.7", target), "skipped-present");
    assert.equal(await install("1.22.6", target), "downloaded", "vsdev's own install is replaced by another version");
    assert.equal(gameInfo(target)?.version, "1.22.6");

    // A client (someone's installed game) is never replaced by a server, and the same version counts as present.
    const client = path.join(dir, "client");
    mkdirSync(path.join(client, "assets", "survival", "textures", "block"), { recursive: true });
    writeFileSync(path.join(client, "VintagestoryAPI.dll"), "");
    writeFileSync(path.join(client, "assets", "version-1.22.7.txt"), "");
    writeFileSync(path.join(client, "assets", "survival", "textures", "block", "linen.png"), "png");
    assert.equal(await install("1.22.7", client), "skipped-present", "a client includes the server");
    await assert.rejects(install("1.22.6", client), /replace it with less/);
    assert.equal(gameInfo(client)?.kind, "client");

    const mine = path.join(dir, "mine"); // a server someone installed by hand: no marker
    mkdirSync(path.join(mine, "assets"), { recursive: true });
    writeFileSync(path.join(mine, "VintagestoryAPI.dll"), "");
    writeFileSync(path.join(mine, "assets", "version-1.21.0.txt"), "");
    assert.equal(planGameInstall(mine, "1.22.7").action, "skip");
    assert.equal(await install("1.22.7", mine), "skipped-present");
    assert.equal(gameInfo(mine)?.version, "1.21.0", "left alone without --force");

    await assert.rejects(install("0.0.0", target, true), /HTTP 404/);
    assert.equal(gameInfo(target)?.version, "1.22.6", "the working install survives a failed --force");
    assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith(".")), [], "no temp files left");
    assert.ok(requested.every((u) => u.includes("/vs_server_linux-x64_")), "only the server is ever requested");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vsdev game options", () => {
  const env = (extra: Partial<LocationEnv> = {}): LocationEnv => ({ cwd: "/w", env: {}, home: "/h", platform: "linux", config: null, ...extra });
  assert.deepEqual(parseGameArgs([], env()), { kind: "server", branch: "stable", version: undefined, dir: "/w/vintagestory", dirFrom: "./vintagestory", force: false, acceptClientTerms: false });
  assert.deepEqual(parseGameArgs(["--server", "--version", "v1.21.6", "--branch", "unstable", "--game-dir", "s", "--force"], env()), { kind: "server", branch: "unstable", version: "1.21.6", dir: "/w/s", dirFrom: "--game-dir", force: true, acceptClientTerms: false });
  assert.equal((parseGameArgs(["--client"], env()) as { kind: string }).kind, "client", "--client is parsed (runGame then only explains where it comes from)");
  assert.equal((parseGameArgs(["--client", "--accept-client-terms"], env()) as { acceptClientTerms: boolean }).acceptClientTerms, true);
  const fromEnv = parseGameArgs([], env({ env: { VINTAGE_STORY: "/opt/vs", VINTAGE_STORY_VERSION: "1.21.0" } }));
  assert.deepEqual(fromEnv !== "help" && [fromEnv.dir, fromEnv.dirFrom, fromEnv.version], ["/opt/vs", "$VINTAGE_STORY", "1.21.0"]);
  const fromConfig = parseGameArgs([], env({ config: { file: "/p/vs-manifest.json", dir: "/p", gameKind: "client", gameDir: "game", serverBranch: "unstable", gameVersion: "1.22.0" } }));
  assert.deepEqual(fromConfig !== "help" && [fromConfig.kind, fromConfig.dir, fromConfig.branch, fromConfig.version], ["client", "/p/game", "unstable", "1.22.0"]);
  assert.equal(parseGameArgs(["--help"], env()), "help");
  assert.throws(() => parseGameArgs(["--client", "--server"], env()), /pick one/);
  assert.throws(() => parseGameArgs(["--branch", "nightly"], env()), /stable or unstable/);
  assert.throws(() => parseGameArgs(["--bogus"], env()), /bogus/);
});
