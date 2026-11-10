// vsdev moddb (the ModDbCli port), offline. Most cases are ModDbCli.Tests ported one for one (Tests.cs, DraftPageTests.cs, ServeTests.cs,
// with the same sample mod; ModDB's HTML pages are hand-built here with only the markup the parser reads, never saved copies of the site);
// the export, --source installs and the location rule are new. ModDB is a fake fetch.
import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { clientDataDir, gameInfo, resolveGameDir, resolveGameVersionLocal, resolveModsDir, resolveProjectDir, type LocationEnv } from "../src/locations.js";
import { htmlLint, imageChecks, imageDimensions, parseTriple, versionWarnings } from "../src/moddb/checks.js";
import { comparePage, unifiedDiff } from "../src/moddb/compare.js";
import { exportSite } from "../src/moddb/export.js";
import { buildFiles, imageUrls, PLACEHOLDER, tidyHtml, writeText } from "../src/moddb/files.js";
import { expandRanges, LiveClient, parseDraftPage, parseLiveMod, type LiveMod } from "../src/moddb/live.js";
import { localMods, readReleaseZip, selectMods, type ReleaseZip } from "../src/moddb/releases.js";
import { ReportBuilder } from "../src/moddb/report.js";
import { scaffold, sideOf, toHttps } from "../src/moddb/scaffold.js";
import { startReviewServer } from "../src/moddb/server.js";
import { PageValidator } from "../src/moddb/validate.js";
import { applyInstallPlan, resolveInstallPlan } from "../src/mods/install.js";
import { ModDb } from "../src/mods/moddb.js";
import { sha256, type Source } from "../src/mods/source.js";


/**
 * A mod page laid out like mods.vintagestory.at's /show/mod/<id> HTML, but only the parts parseDraftPage reads (title, side, tags,
 * links, the screenshot stage, the description between its two markers, the files tab's release rows), with made-up content.
 */
function modPageHtml(o: {
  name: string; side: string; tags: string[]; links: [string, string][]; logo?: string; screenshots: string[]; description: string; draft?: boolean;
  releases: { version: string; games: string[]; file: string; changelog?: string }[];
}): string {
  return `<html><head>${o.logo ? `<meta property="og:image" content="${o.logo}">` : ""}</head><body${o.draft ? ' class="mod-draft"' : ""}>
<h2><span>Mods</span> / <span> ${o.name} </span></h2>
<dl><dt>Side:</dt>
<dt>${o.side}</dt>
<dd class="tags">${o.tags.map((t) => `<a href="#" class="tag">${t}</a>`).join(" ")}</dd></dl>
<ul>${o.links.map(([label, url]) => `<li><a class="external" rel="nofollow" href="${url}">${label}</a></li>`).join("")}</ul>
<div class="slider"><div class="stage">${o.screenshots.map((u) => `<img src="${u}">`).join("")}</div>
</div><button class="next">&gt;</button>
<div style="clear:both;"><br></div>
${o.description}
<div style="clear:both;"></div>
<div class="tab-content files"><table>
${o.releases.map((r) => `<tr data-assetid="7" ><td> ${r.version} </td><td>${r.games.map((g) => `<span class="tag">${g}</span>`).join("")}</td><td><a class="button square ico-button mod-dl" href="/download/7/${r.file}">${r.file}</a></td></tr>${
  r.changelog === undefined ? "" : `
<tr><td class="collapsable cl-changelog" colspan="3"><div><div><div class="release-changelog">${r.changelog}</div></div></div>
</td></tr>`}`).join("\n")}
</table></div></body></html>`;
}
const tmp = (name: string) => mkdtempSync(path.join(tmpdir(), `vsdev-moddb-${name}-`));

// ModDbCli.Tests' Samples.ApiJson.
const API_JSON = `{"statuscode":"200","mod":{"modid":42,"assetid":4242,"name":"Sample","urlalias":null,"side":"both","type":"mod",
 "text":"<p>Hello</p>\\r\\n","homepageurl":"","sourcecodeurl":"https://example.com/repo","trailervideourl":null,
 "issuetrackerurl":"","wikiurl":"","downloads":9,"tags":["QoL","building","Tools"],
 "logofile":"https://cdn.example.com/logo_abc123.PNG",
 "screenshots":[{"filename":"Main.png","mainfile":"https://cdn.example.com/Main_x.png"}],
 "releases":[{"modversion":"1.0.1","filename":"s.zip","tags":["1.22.7","1.21.0"],"changelog":"<p>Fix</p>"},
             {"modversion":"1.0.0","filename":"s0.zip","tags":["1.21.0"],"changelog":""}]}}`;
const sampleMod = () => parseLiveMod(API_JSON)!;
const IMAGES: Record<string, Buffer> = { "https://cdn.example.com/logo_abc123.PNG": Buffer.from([1, 2, 3]), "https://cdn.example.com/Main_x.png": Buffer.from([4, 5, 6]) };

/** A LiveClient over a fake site: api/mod/<id> answers from `mods` (raw JSON), show/mod/<n> from `pages`, absolute URLs from `files`. */
function fakeClient(mods: Record<string, string>, files: Record<string, Buffer> = IMAGES, pages: Record<number, string> = {}): LiveClient {
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    if (files[url.href]) return new Response(new Uint8Array(files[url.href]));
    if (url.pathname.startsWith("/api/mod/")) return new Response(mods[decodeURIComponent(url.pathname.slice(9))] ?? '{"statuscode":"404"}');
    if (url.pathname.startsWith("/show/mod/")) {
      const html = pages[Number(url.pathname.slice(10))];
      return html ? new Response(html) : new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return new LiveClient(new ModDb(fetchImpl));
}

function modZip(dir: string, file: string, modinfo: string | null, extra: Record<string, string> = {}): string {
  const zip = new AdmZip();
  if (modinfo !== null) zip.addFile("modinfo.json", Buffer.from(modinfo));
  for (const [name, text] of Object.entries(extra)) zip.addFile(name, Buffer.from(text));
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, file);
  zip.writeZip(p);
  return p;
}

/** Writes the sample mod's files and images into `modDir` (PageComparerTests.Seed). */
function seed(modDir: string): void {
  for (const [name, text] of Object.entries(buildFiles("sample", sampleMod()))) writeText(path.join(modDir, name), text);
  for (const [name, url] of Object.entries(imageUrls(sampleMod()))) {
    mkdirSync(path.join(modDir, "images"), { recursive: true });
    writeFileSync(path.join(modDir, name), IMAGES[url]);
  }
}

test("version rules (VersionRulesTests)", () => {
  for (const [version, listed, natural] of [["1.0.1", "1.0.0", true], ["1.1.0", "1.0.5", true], ["2.0.0", "1.9.9", true], ["1.2.0", "1.0.0", false], ["1.0.0", "1.0.0", false], ["1.0.2", "1.0.0", false]] as const) {
    assert.equal(versionWarnings(version, [listed]).length === 0, natural, `${version} after ${listed}`);
  }
  assert.deepEqual(versionWarnings("1.0.0", []), []);
  assert.equal(versionWarnings("abc", ["1.0.0"]).length, 1);
  assert.deepEqual(parseTriple("1.2.3-rc.1"), [1, 2, 3]);
});

test("page files (PageFilesTests)", () => {
  assert.equal(tidyHtml("  <p>a</p>\r\n<p>b</p>\r\n\r\n"), "<p>a</p>\n<p>b</p>\n");
  assert.equal(tidyHtml("  \n"), "");
  assert.equal(tidyHtml(null), "");
  const files = buildFiles("sample", sampleMod());
  assert.deepEqual(Object.keys(files), ["description.html", "page.json", "releases/1.0.0.html", "releases/1.0.0.json", "releases/1.0.1.html", "releases/1.0.1.json"]);
  const page = JSON.parse(files["page.json"]);
  assert.deepEqual(Object.keys(page), ["modid", "moddbId", "urlalias", "name", "side", "type", "homepageurl", "sourcecodeurl", "trailervideourl", "issuetrackerurl", "wikiurl", "tags", "logo", "screenshots"]);
  assert.deepEqual(page.tags, ["building", "QoL", "Tools"]);
  assert.equal(page.logo, "logo.png");
  assert.equal(page.moddbId, 42);
  assert.ok(files["page.json"].endsWith("}\n") && !files["page.json"].includes("\r"));
  assert.deepEqual(JSON.parse(files["releases/1.0.1.json"]).gameVersions, ["1.21.0", "1.22.7"]);
  assert.deepEqual(Object.keys(imageUrls(sampleMod())), ["images/Main.png", "images/logo.png"]);
  assert.equal(parseLiveMod('{"statuscode":"404"}'), null);
  assert.equal(parseLiveMod('{"mod":null}'), null);
});

test("unified diff (UnifiedDiffTests)", () => {
  assert.equal(unifiedDiff("a\nb\n", "a\nb\n", "x", "y"), "");
  assert.equal(unifiedDiff("a\nb\nc\n", "a\nB\nc\n", "local/f", "live/f"), "--- local/f\n+++ live/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n");
  assert.equal(unifiedDiff("x\ny\n", "", "l", "v"), "--- l\n+++ v\n@@ -1,2 +0,0 @@\n-x\n-y\n");
});

test("release zips (ReleaseZipsTests), plus the template's short file name", () => {
  const dir = tmp("zips");
  try {
    const z = readReleaseZip(modZip(dir, "ignored_1_9.9.9.zip", '\uFEFF{"ModID":"Sample","Version":"1.2.3","Name":"S","Dependencies":{"game":"1.22.7"},"Side":"Client"}'));
    assert.deepEqual([z.modid, z.version, z.name, z.gameVersion, z.side], ["sample", "1.2.3", "S", "1.22.7", "Client"]);
    const f = readReleaseZip(modZip(dir, "samplemod_1.22.7_3.1.4.zip", null));
    assert.deepEqual([f.modid, f.version], ["samplemod", "3.1.4"]);
    const short = readReleaseZip(modZip(dir, "othermod_2.0.1.zip", null));
    assert.deepEqual([short.modid, short.version], ["othermod", "2.0.1"]);
    const m = path.join(dir, "m");
    modZip(m, "m_1_1.9.0.zip", '{"modid":"m","version":"1.9.0"}');
    modZip(m, "m_1_1.10.0.zip", '{"modid":"m","version":"1.10.0"}');
    assert.equal(localMods(m).get("m")!.version, "1.10.0");
    assert.throws(() => selectMods(new Map([["a", {}]]), ["b"]), /unknown modid.*Known.*a/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("page comparer (PageComparerTests)", async () => {
  const dir = tmp("compare");
  try {
    const modDir = path.join(dir, "sample");
    const compare = (live: LiveMod | null) => comparePage(fakeClient({}), new PageValidator(dir), "sample", live, modDir);
    seed(modDir);
    writeFileSync(path.join(modDir, ".gitignore"), "images\n");
    let d = await compare(sampleMod());
    assert.equal(d.status, "same");
    assert.deepEqual(d.warnings, []);

    appendFileSync(path.join(modDir, "description.html"), "<p>x</p>\n");
    writeFileSync(path.join(modDir, "images", "logo.png"), Buffer.from([9]));
    d = await compare(sampleMod());
    assert.equal(d.status, "changed");
    assert.deepEqual(d.changed, ["description.html", "images/logo.png"]);
    assert.ok(d.diff.includes("-<p>x</p>"));

    rmSync(modDir, { recursive: true });
    seed(modDir);
    writeText(path.join(modDir, "releases", "2.0.0.html"), "<p>next</p>\n");
    d = await compare(sampleMod());
    assert.equal(d.status, "same");
    assert.deepEqual(d.pending, ["releases/2.0.0.html"]);

    unlinkSync(path.join(modDir, "releases", "1.0.1.html"));
    assert.equal((await compare(sampleMod())).status, "changed");
    assert.equal((await compare(null)).status, "scaffolded");
    assert.equal((await comparePage(fakeClient({}), new PageValidator(dir), "sample", null, path.join(dir, "nothing"))).status, "missing-scaffold");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const sampleZip = (side = "Universal"): ReleaseZip => ({ file: "m_1.22.7_1.0.0.zip", path: "", modid: "m", version: "1.0.0", name: "My Mod", side, description: "Does <things> & stuff.", gameVersion: "1.22.7" });

test("scaffold (ScaffolderTests): schema-valid, no overwrite unless forced, side, git remote", () => {
  const dir = tmp("scaffold");
  try {
    const modDir = path.join(dir, "m");
    assert.deepEqual(scaffold(sampleZip(), modDir, "https://example.com/r", false), ["page.json", "description.html", "releases/1.0.0.json", "releases/1.0.0.html"]);
    const validator = new PageValidator(dir); // no schema in the folder: the bundled one
    assert.deepEqual(validator.validate(readFileSync(path.join(modDir, "page.json"), "utf8")), []);
    const description = readFileSync(path.join(modDir, "description.html"), "utf8");
    assert.ok(description.includes("Does &lt;things&gt; &amp; stuff.") && description.includes(PLACEHOLDER));
    writeFileSync(path.join(modDir, "description.html"), "mine");
    assert.deepEqual(scaffold(sampleZip(), modDir, "", false), []);
    assert.equal(readFileSync(path.join(modDir, "description.html"), "utf8"), "mine");
    assert.equal(scaffold(sampleZip(), modDir, "", true).length, 4);
    assert.deepEqual(validator.validate('{"modid":"Bad","side":"up"}').slice(0, 2), ["/: must have required property 'moddbId'", "/: must have required property 'name'"]);
    assert.ok(validator.validate('{"modid":"m","moddbId":null,"name":"x","side":"up","type":"mod","tags":[],"logo":null,"screenshots":[]}').some((p) => p.includes("/side") && p.includes("both, client, server")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual([sideOf("Universal"), sideOf("Client"), sideOf("server"), sideOf(undefined)], ["both", "client", "server", "both"]);
  assert.equal(toHttps("git@github.com:jgwoolley/translocator-locator-cmd.git"), "https://github.com/jgwoolley/translocator-locator-cmd");
  assert.equal(toHttps("https://github.com/a/b.git"), "https://github.com/a/b");
  assert.equal(toHttps("ssh://git@host/a/b"), "https://host/a/b");
});

/** A PNG header of a given size (ImageChecksTests.Png). */
const png = (w: number, h: number) => {
  const d = Buffer.alloc(24);
  d.set([0x89, 0x50, 0x4e, 0x47]);
  d.writeUInt32BE(w, 16);
  d.writeUInt32BE(h, 20);
  return d;
};
const jpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);

test("image checks and HTML lint (ImageChecksTests, HtmlLintTests)", () => {
  assert.deepEqual(imageDimensions(png(480, 480)), [480, 480]);
  assert.deepEqual(imageDimensions(jpeg(1920, 1080)), [1920, 1080]);
  assert.equal(imageDimensions(Buffer.from([1, 2, 3])), null);
  assert.deepEqual(imageChecks("logo", "logo.png", png(480, 480)), []);
  assert.equal(imageChecks("logo", "logo.png", png(128, 128)).length, 1);
  assert.deepEqual(imageChecks("icon", "modicon.png", png(128, 128)), []);
  assert.equal(imageChecks("screenshot", "a.jpg", jpeg(2560, 1440)).length, 1);
  assert.equal(imageChecks("screenshot", "a.png", Buffer.from([1, 2, 3])).length, 1);
  assert.deepEqual(htmlLint("d.html", '<p>a <strong>b</strong></p><ul><li>c</li></ul><pre class="language-json"><code>x</code></pre>'), []);
  for (const pre of ["<pre>x</pre>", "<pre><code>x</code></pre>", '<pre class="language-json">x</pre>']) {
    assert.ok(htmlLint("d.html", pre).some((w) => w.includes("language-") && w.includes("<code>")), pre);
  }
  const bad = htmlLint("d.html", "<h1>x</h1><p>y</p><script>1</script>");
  assert.equal(bad.length, 1);
  assert.ok(bad[0].includes("<h1>"));
});

test("draft pages (DraftPageTests): a page parses like the API; a draft; range expansion; unknown markup", () => {
  const shot = "https://moddbcdn.vintagestory.at/Main_0123456789abcdef0123456789abcdef.png";
  const logo = "https://moddbcdn.vintagestory.at/modicon_abc.png";
  const api = parseLiveMod(JSON.stringify({ statuscode: "200", mod: {
    modid: 7, name: "Sample & Co", side: "both", tags: ["Tools", "QoL"], text: "<p>Soaks up <em>water</em>.</p>", logofile: logo,
    sourcecodeurl: "https://example.com/src", screenshots: [{ filename: "Main.png", mainfile: shot }],
    releases: [
      { modversion: "2.0.1", filename: "sample_1.22.7_2.0.1.zip", tags: ["1.22.0-pre.1", "1.22.0", "1.22.7"], changelog: "<p>Fix &amp; tidy</p>" },
      { modversion: "1.0.1", filename: "sample_1.21.7_1.0.1.zip", tags: ["1.21.0-pre.1", "1.21.7"], changelog: "" },
    ],
  } }))!;
  const page = parseDraftPage(modPageHtml({
    name: "Sample &amp; Co", side: "Both", tags: ["Tools", "QoL"], links: [["Source", "https://example.com/src"]], logo, screenshots: [shot],
    description: "<p>Soaks up <em>water</em>.</p>",
    releases: [
      { version: "2.0.1", games: ["1.22.0-pre.1 - 1.22.7"], file: "sample_1.22.7_2.0.1.zip", changelog: "<p>Fix &amp; tidy</p>" },
      { version: "1.0.1", games: ["1.21.0-pre.1 - 1.21.7"], file: "sample_1.21.7_1.0.1.zip" },
    ],
  }));
  const fromApi = buildFiles("sample", api), fromPage = buildFiles("sample", page);
  assert.equal(fromPage["description.html"], fromApi["description.html"]);
  for (const k of Object.keys(fromApi).filter((k) => k.startsWith("releases/") && k.endsWith(".html"))) assert.equal(fromPage[k], fromApi[k], k);
  assert.deepEqual(page.releases.map((r) => [r.version, r.fileName]), api.releases.map((r) => [r.version, r.fileName]));
  assert.deepEqual([...page.tags].sort(), [...api.tags].sort());
  assert.equal(page.name, api.name, "HTML entities decoded");
  assert.equal(page.side, "both");
  assert.equal(page.sourceCodeUrl, api.sourceCodeUrl);
  assert.equal(page.logoUrl, api.logoUrl);
  assert.deepEqual(page.screenshots, api.screenshots, "the CDN hash is dropped from the screenshot name");
  assert.equal(page.isDraft, false);

  const draft = parseDraftPage(modPageHtml({
    name: "A Draft Mod", side: "Both", tags: [], links: [], screenshots: [], description: "<p>Not published yet.</p>", draft: true,
    releases: [{ version: "1.0.1", games: ["1.22.0-pre.1 - 1.22.7"], file: "draftmod_1.22.7_1.0.1.zip", changelog: "<p>First.</p>" }],
  }));
  assert.equal(draft.isDraft, true);
  assert.equal(draft.name, "A Draft Mod");
  assert.deepEqual(draft.tags, []);
  assert.equal(draft.text, "<p>Not published yet.</p>");
  assert.equal(draft.logoUrl, null);
  assert.deepEqual([draft.releases[0].version, draft.releases[0].fileName, draft.releases[0].gameVersions, draft.releases[0].changelog], ["1.0.1", "draftmod_1.22.7_1.0.1.zip", ["1.22.0-pre.1 - 1.22.7"], "<p>First.</p>"]);

  const dir = tmp("ranges");
  try {
    mkdirSync(path.join(dir, "releases"));
    writeFileSync(path.join(dir, "releases", "2.0.1.json"), '{"version":"2.0.1","gameVersions":["1.22.0-pre.1","1.22.0","1.22.7"],"filename":"x.zip"}');
    const expanded = expandRanges(page, dir);
    assert.deepEqual(expanded.releases.find((r) => r.version === "2.0.1")!.gameVersions, ["1.22.0-pre.1", "1.22.0", "1.22.7"]);
    assert.deepEqual(expanded.releases.find((r) => r.version === "1.0.1")!.gameVersions, ["1.21.0-pre.1 - 1.21.7"], "no local file: the range stays");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.throws(() => parseDraftPage("<html><body>maintenance</body></html>"), /not recognized/);
});

/** Releases/ with "sample" 1.0.2 (a new version) and "draft" 1.0.0 (unpublished), plus a pages folder (ServeTests.Builder). */
function project(dir: string): { releases: string; pages: string } {
  const releases = path.join(dir, "Releases"), pages = path.join(dir, "moddb");
  modZip(releases, "sample_1.22.7_1.0.2.zip", '{"modid":"sample","version":"1.0.2","name":"N","side":"both","description":"d"}');
  modZip(releases, "draft_1.22.7_1.0.0.zip", '{"modid":"draft","version":"1.0.0","name":"N","side":"both","description":"d"}');
  mkdirSync(pages, { recursive: true });
  return { releases, pages };
}

test("report (ModReportTests): states, tasks and the image rule", async () => {
  const dir = tmp("report");
  try {
    const { releases, pages } = project(dir);
    seed(path.join(pages, "sample"));
    unlinkSync(path.join(pages, "sample", "images", "Main.png"));
    const builder = new ReportBuilder(releases, pages, () => fakeClient({ sample: API_JSON }));
    const sample = await builder.build("sample");
    assert.equal(sample.state, "new-version");
    assert.ok(sample.tasks.some((t) => t.id === "sample:upload:1.0.2"));
    assert.ok(sample.warnings.some((w) => w.includes("no changelog written for 1.0.2")));
    assert.ok(sample.warnings.some((w) => w.includes("screenshot Main.png is not in moddb/sample/images/")), "a missing image is reported even when published");
    assert.equal(sample.pullCommand, "vsdev moddb pull sample");
    assert.equal(sample.pageUrl, "https://mods.vintagestory.at/show/mod/4242");

    const draft = await builder.build("draft");
    assert.equal(draft.state, "unpublished");
    assert.ok(draft.tasks.some((t) => t.id === "draft:create"));
    assert.ok(draft.warnings.some((w) => w.includes("no tags")));

    const offline = new ReportBuilder(releases, pages, () => new LiveClient(null));
    const r = await offline.build("sample");
    assert.equal(r.state, "offline");
    assert.equal(r.localVersion, "1.0.2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function http(port: number, method: string, p: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode!, body: data }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("review server (ServeTests): pages, reports, progress only, and the origin/host/path checks", async () => {
  const dir = tmp("serve");
  try {
    const { releases, pages } = project(dir);
    seed(path.join(pages, "sample"));
    const server = await startReviewServer(new ReportBuilder(releases, pages, () => fakeClient({ sample: API_JSON })), ["sample", "draft"], 0);
    try {
      const host = { Host: `127.0.0.1:${server.port}` };
      assert.ok((await http(server.port, "GET", "/", host)).body.includes("<html"));
      assert.equal(JSON.parse((await http(server.port, "GET", "/api/report/sample", host)).body).state, "new-version");
      assert.equal((await http(server.port, "GET", "/api/report/nope", host)).status, 404);
      await http(server.port, "POST", "/api/progress", host, '{"id":"sample:tags","done":true}');
      assert.equal(JSON.parse((await http(server.port, "GET", "/api/progress", host)).body)["sample:tags"], true);
      await http(server.port, "POST", "/api/progress", host, '{"id":"sample:tags","done":false}');
      assert.equal(JSON.parse(readFileSync(path.join(pages, ".progress.json"), "utf8"))["sample:tags"], undefined);
      assert.equal((await http(server.port, "POST", "/api/progress", { ...host, Origin: "http://evil.example" }, '{"id":"a","done":true}')).status, 403);
      assert.equal((await http(server.port, "GET", "/api/mods", { Host: "evil.example" })).status, 403, "DNS rebinding: a foreign Host is refused");
      assert.equal((await http(server.port, "GET", "/img/sample/logo.png", host)).status, 200);
      assert.equal((await http(server.port, "GET", "/img/sample/..%2F..%2Fpage.json", host)).status, 404);
      assert.deepEqual(readdirSync(pages).sort(), [".progress.json", "sample"], "nothing else written");
    } finally {
      await server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export: a public site with the zips and mods.json, no dev information, safe about its output folder", async () => {
  const dir = tmp("export");
  try {
    const { releases, pages } = project(dir);
    seed(path.join(pages, "sample"));
    writeText(path.join(pages, "sample", "releases", "1.0.2.html"), "<p>New thing</p>\n");
    scaffold(readReleaseZip(path.join(releases, "draft_1.22.7_1.0.0.zip")), path.join(pages, "draft"), "", false);
    const out = path.join(dir, ".vsdev", "site");
    const result = await exportSite({ pagesDir: pages, outDir: out, modids: ["draft", "sample"], zips: localMods(releases), client: fakeClient({ sample: API_JSON }) });
    assert.ok(result.warnings.some((w) => w.startsWith("draft:") && w.includes(PLACEHOLDER)), "placeholders are reported on the command line");
    for (const f of ["index.html", "mods.json", "style.css", ".nojekyll", "sample/index.html", "sample/images/logo.png", "sample/images/Main.png", "sample/files/sample_1.22.7_1.0.2.zip"]) assert.ok(existsSync(path.join(out, f)), f);
    const html = readFileSync(path.join(out, "sample", "index.html"), "utf8");
    assert.ok(html.includes("<p>Hello</p>") && html.includes("<p>New thing</p>") && html.includes("not on ModDB yet"));
    assert.ok(!/WARNING|checklist|\.progress|moddb\/sample|vsdev-moddb/i.test(html), "no dev information or local paths");
    for (const href of [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])) assert.ok(!href.startsWith("/") && !href.startsWith("file:"), `relative link: ${href}`);
    const index = JSON.parse(readFileSync(path.join(out, "mods.json"), "utf8"));
    const rel = index.mods.find((m: { modid: string }) => m.modid === "sample").releases[0];
    assert.equal(rel.version, "1.0.2");
    assert.equal(rel.sha256, sha256(readFileSync(path.join(releases, "sample_1.22.7_1.0.2.zip"))));
    assert.equal(rel.onModDb, false);

    // Re-exporting replaces its own output, in the same folder (a bind mount keeps working); anything else is refused.
    const inode = statSync(out).ino;
    await exportSite({ pagesDir: pages, outDir: out, modids: ["sample"], zips: localMods(releases), client: null });
    assert.ok(!existsSync(path.join(out, "draft")));
    assert.equal(statSync(out).ino, inode, "the folder itself is kept");
    assert.ok(!JSON.parse(readFileSync(path.join(out, "mods.json"), "utf8")).mods[0].releases[0].onModDb, "offline: no on-ModDB claim");
    await assert.rejects(exportSite({ pagesDir: pages, outDir: dir, modids: ["sample"], zips: localMods(releases), client: null }), /contains/);
    mkdirSync(path.join(dir, "other"));
    writeFileSync(path.join(dir, "other", "keep.txt"), "x");
    await assert.rejects(exportSite({ pagesDir: pages, outDir: path.join(dir, "other"), modids: ["sample"], zips: localMods(releases), client: null }), /refusing/);
    assert.ok(existsSync(path.join(dir, "other", "keep.txt")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export: Releases/ is the truth for the mod itself (side, icon, description fallback); moddb/ for what the page manages", async () => {
  const dir = tmp("export-zip");
  try {
    const releases = path.join(dir, "Releases"), pages = path.join(dir, "moddb");
    modZip(releases, "srv_1.22.7_1.0.0.zip", '{"modid":"srv","version":"1.0.0","name":"Srv","side":"Server","description":"Logs <things>"}', { "modicon.png": "ICON" });
    modZip(releases, "paged_1.22.7_1.0.0.zip", '{"modid":"paged","version":"1.0.0","name":"P","side":"Client"}', { "modicon.png": "ICON" });
    seed(path.join(pages, "paged"));
    const pagedJson = path.join(pages, "paged", "page.json");
    writeFileSync(pagedJson, JSON.stringify({ ...JSON.parse(readFileSync(pagedJson, "utf8")), side: "both" }));
    const out = path.join(dir, "site");
    const result = await exportSite({ pagesDir: pages, outDir: out, modids: ["paged", "srv"], zips: localMods(releases), client: null });

    // No moddb/srv/ at all: name, side, description and logo all come from the zip.
    assert.equal(readFileSync(path.join(out, "srv", "images", "modicon.png"), "utf8"), "ICON");
    const srv = readFileSync(path.join(out, "srv", "index.html"), "utf8");
    assert.ok(srv.includes("<h1>Srv</h1>") && srv.includes("Server only") && srv.includes("<p>Logs &lt;things&gt;</p>") && srv.includes('src="images/modicon.png"'));

    // A page with its own logo keeps it; the side still follows the zip, with a warning about the disagreement.
    assert.ok(!existsSync(path.join(out, "paged", "images", "modicon.png")), "page.json's logo wins over the zip icon");
    assert.ok(readFileSync(path.join(out, "paged", "index.html"), "utf8").includes("Client only"));
    assert.ok(result.warnings.some((w) => w.startsWith("paged:") && w.includes('side "both"') && w.includes('"Client"')));
    assert.ok(readFileSync(path.join(out, "index.html"), "utf8").includes('src="srv/images/modicon.png"'), "the card uses the zip icon");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--source: installs from a site's mods.json, checks the sha256, other mods still from ModDB", async () => {
  const zip = (modinfo: object) => {
    const z = new AdmZip();
    z.addFile("modinfo.json", Buffer.from(JSON.stringify(modinfo)));
    return z.toBuffer();
  };
  const site = zip({ modid: "mine", version: "2.0.0", dependencies: { game: "1.22.0", lib: "" } });
  const libZip = zip({ modid: "lib", version: "1.0.0" });
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.href === "https://me.example/site/mine/files/mine.zip") return new Response(new Uint8Array(site));
    if (url.href === "https://me.example/site/mine/files/bad.zip") return new Response(new Uint8Array(Buffer.from("tampered")));
    if (url.host === "cdn.vintagestory.at") return new Response("[]");
    if (url.pathname === "/api/v2/mods/install-information") return new Response(JSON.stringify({ data: { lib: { fileName: "lib.zip", fileUrl: "/d/lib.zip", recommendedUpgrade: "1.0.0" } } }));
    if (url.pathname === "/d/lib.zip") return new Response(new Uint8Array(libZip));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const source: Source = {
    url: "https://me.example/site/",
    mods: [{ modid: "mine", name: "Mine", page: "mine/", releases: [
      { version: "2.0.0", gameVersions: ["1.22.7"], file: "mine/files/mine.zip", sha256: sha256(site), size: site.length, dependencies: { lib: "" } },
      { version: "1.0.0", gameVersions: ["1.21.0"], file: "mine/files/bad.zip", sha256: "0".repeat(64), size: 1, dependencies: {} },
    ] }],
  };
  const db = new ModDb(fetchImpl);
  const dir = tmp("source");
  try {
    const plan = await resolveInstallPlan([{ spec: "mine" }], { db, gameVersion: "1.22.7", installed: new Map(), sources: [source] });
    assert.deepEqual(plan.map((e) => [e.modid, e.action, e.version, e.source]), [["mine", "install", "2.0.0", "https://me.example/site/"], ["lib", "install", "1.0.0", undefined]]);
    await applyInstallPlan(plan, { modsDir: dir, outDir: dir, db });
    assert.deepEqual(readdirSync(dir).sort(), ["lib.zip", "mine.zip"]);
    const pinned = await resolveInstallPlan([{ spec: "mine@1.0.0" }], { db, installed: new Map(), sources: [source] });
    assert.match(pinned[0].error!, /checksum doesn't match/);
    const missing = await resolveInstallPlan([{ spec: "mine@3.0.0" }], { db, installed: new Map(), sources: [source] });
    assert.match(missing[0].error!, /no version 3\.0\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("locations: flag, env, vs-manifest.json, local, installed; writes stop before installed", () => {
  const dir = tmp("locations");
  try {
    const home = path.join(dir, "home"), cwd = path.join(dir, "project", "sub");
    mkdirSync(cwd, { recursive: true });
    const makeGame = (p: string, kind: "client" | "server", version = "1.22.7") => {
      mkdirSync(path.join(p, "assets"), { recursive: true });
      writeFileSync(path.join(p, "VintagestoryAPI.dll"), "");
      writeFileSync(path.join(p, "assets", `version-${version}.txt`), "");
      if (kind === "client") writeText(path.join(p, "assets", "survival", "textures", "block", "linen.png"), "png");
    };
    const env = (extra: Partial<LocationEnv> = {}): LocationEnv => ({ cwd, env: {}, home, platform: "linux", config: null, ...extra });

    // Nothing anywhere: reads find nothing, writes land in ./vintagestory (client or server alike).
    assert.equal(resolveGameDir({ mode: "read" }, env()).path, undefined);
    assert.equal(resolveGameDir({ mode: "write" }, env()).path, path.join(cwd, "vintagestory"));
    assert.equal(resolveModsDir({ mode: "write" }, env()).path, path.join(cwd, "Mods"));

    // An old ./vs_server is read, and reused for downloads while it is the only one (no second copy).
    makeGame(path.join(cwd, "vs_server"), "server");
    assert.deepEqual([resolveGameDir({ mode: "read" }, env()).path, resolveGameDir({ mode: "read" }, env()).tier], [path.join(cwd, "vs_server"), "local"]);
    assert.equal(resolveGameDir({ mode: "write" }, env()).path, path.join(cwd, "vs_server"));

    // Installed (tier 5) only for reads; only a client has textures.
    makeGame(path.join(home, ".local", "share", "vintagestory"), "client", "1.22.6");
    const textures = resolveGameDir({ mode: "read", needClient: true }, env());
    assert.deepEqual([textures.path, textures.tier], [path.join(home, ".local", "share", "vintagestory"), "installed"]);
    assert.equal(resolveGameDir({ mode: "read", installed: false, needClient: true }, env()).path, undefined, "the wiki's reads never reach tier 5");
    makeGame(path.join(cwd, "vintagestory"), "client");
    assert.equal(resolveGameDir({ mode: "read" }, env()).path, path.join(cwd, "vintagestory"), "./vintagestory before the old ./vs_server");
    assert.equal(resolveGameDir({ mode: "write" }, env()).path, path.join(cwd, "vintagestory"));
    assert.equal(resolveGameDir({ mode: "write" }, env()).tier, "local", "writes never pick the installed tier");
    assert.deepEqual(gameInfo(path.join(cwd, "vintagestory")), { kind: "client", version: "1.22.7" });

    // vs-manifest.json in a parent folder (paths relative to it), beaten by the env var, beaten by the flag.
    writeFileSync(path.join(dir, "project", "vs-manifest.json"), JSON.stringify({ gameDir: "game", dataDir: "data", gameVersion: "1.21.0", releasesDir: "out", pagesDir: "pages" }));
    const withConfig = { ...env(), config: undefined };
    assert.deepEqual([resolveGameDir({ mode: "read" }, withConfig).path, resolveGameDir({ mode: "read" }, withConfig).tier], [path.join(dir, "project", "game"), "config"]);
    assert.equal(resolveModsDir({ mode: "write" }, withConfig).path, path.join(dir, "project", "data", "Mods"));
    assert.equal(resolveProjectDir("releasesDir", undefined, withConfig).path, path.join(dir, "project", "out"));
    assert.equal(resolveProjectDir("pagesDir", undefined, withConfig).path, path.join(dir, "project", "pages"));
    assert.equal(resolveGameVersionLocal(undefined, withConfig).version, "1.21.0");
    const withEnv = { ...withConfig, env: { VINTAGE_STORY: "/opt/vs", VINTAGE_STORY_DATA: "/srv/data", VINTAGE_STORY_VERSION: "v1.20.0" } };
    assert.equal(resolveGameDir({ mode: "read" }, withEnv).path, "/opt/vs");
    assert.equal(resolveModsDir({ mode: "write" }, withEnv).path, "/srv/data/Mods");
    assert.equal(resolveGameVersionLocal(undefined, withEnv).version, "1.20.0");
    assert.equal(resolveGameDir({ flag: "~/vs", mode: "read" }, withEnv).path, path.join(home, "vs"), "the flag wins; ~ is expanded");
    assert.equal(resolveGameVersionLocal(undefined, env()).version, "1.22.7", "else the game install's own version");

    // The game's data folder rule (GamePaths: ApplicationData + VintagestoryData).
    assert.equal(clientDataDir({ env: {}, home: "/home/u", platform: "linux" }), "/home/u/.config/VintagestoryData");
    assert.equal(clientDataDir({ env: { XDG_CONFIG_HOME: "/x" }, home: "/home/u", platform: "linux" }), "/x/VintagestoryData");
    assert.equal(clientDataDir({ env: {}, home: "/Users/u", platform: "darwin" }), "/Users/u/Library/Application Support/VintagestoryData");
    assert.equal(clientDataDir({ env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, home: "C:\\Users\\u", platform: "win32" }), "C:\\Users\\u\\AppData\\Roaming\\VintagestoryData");

    // Reads of Mods fall back to the real data folders; -p keeps vs-mod-updater's meaning (a data folder or a Mods folder).
    mkdirSync(path.join(home, ".config", "VintagestoryData", "Mods"), { recursive: true });
    assert.deepEqual([resolveModsDir({ mode: "read" }, env()).path, resolveModsDir({ mode: "read" }, env()).tier], [path.join(home, ".config", "VintagestoryData", "Mods"), "installed"]);
    assert.equal(resolveModsDir({ mode: "write" }, env()).tier, "local");
    assert.equal(resolveModsDir({ flag: path.join(home, ".config", "VintagestoryData"), mode: "write" }, env()).path, path.join(home, ".config", "VintagestoryData", "Mods"));
    assert.equal(resolveModsDir({ flag: "./mymods", mode: "write" }, env()).path, path.join(cwd, "mymods"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
