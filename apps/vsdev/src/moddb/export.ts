// `vsdev moddb export`: a static site (for GitHub Pages or any web host) that rebuilds each mod's ModDB page from moddb/<modid>/ and
// hosts the newest zip from Releases/, so people can get versions that aren't on ModDB yet. It is the public face, not the review tool:
// no checklist, diffs, warnings, local paths or progress, only what a ModDB page shows (description, screenshots, tags, side, links,
// releases with changelogs and game versions) plus a Download button and the `vsdev mod install <id> --source <site>` command.
//
// Output (all links relative, so it works under a Pages subpath like https://you.github.io/repo/):
//   index.html                 every mod, as cards
//   <modid>/index.html         the mod's page
//   <modid>/images/*           the logo and screenshots named in page.json
//   <modid>/files/<zip>        the newest zip from Releases/
//   mods.json                  the index `vsdev mod install --source` reads (src/mods/source.ts)
//   style.css, .nojekyll
// The game's own one-click install (vintagestorymodinstall://) only installs what ModDB knows, so it can't be offered for these.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { modInfoFromZip, parseModInfo } from "../mods/modinfo.js";
import { sha256, type SourceIndexFile, type SourceMod, type SourceRelease } from "../mods/source.js";
import { compareTriple, parseTriple } from "./checks.js";
import { DESCRIPTION, IMAGES_DIR, PAGE_JSON, PLACEHOLDER, readLocal, releaseHtmlPath } from "./files.js";
import type { LiveClient, LiveMod } from "./live.js";
import type { ReleaseZip } from "./releases.js";

export interface ExportOptions {
  pagesDir: string;
  outDir: string;
  modids: string[];
  /** The newest zip per modid (localMods). */
  zips: Map<string, ReleaseZip>;
  /** For "on ModDB" marks and a link to the ModDB page; null = offline. */
  client: LiveClient | null;
  /** The site's title. */
  title?: string;
}

export interface ExportResult {
  outDir: string;
  mods: { modid: string; page: string; files: string[] }[];
  /** For the command line only: never written into the site. */
  warnings: string[];
}

interface PageData {
  modid: string;
  name: string;
  side: string;
  type: string;
  links: { label: string; url: string }[];
  tags: string[];
  logo: string | null;
  screenshots: string[];
  description: string;
  releases: { version: string; gameVersions: string[]; changelog: string; onModDb: boolean; file?: { name: string; size: number } }[];
  modDbUrl: string | null;
  /** Whether ModDB was asked (online export); "not on ModDB yet" is only claimed then. */
  checked: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const sideLabel: Record<string, string> = { both: "Client and server", client: "Client only", server: "Server only" };
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** A long game-version list as its range ("1.22.0-pre.1 – 1.22.7"), as ModDB's page shows it; short lists in full. */
const gameRange = (versions: string[]) => (versions.length > 3 ? `${versions[0]} – ${versions[versions.length - 1]}` : versions.join(", "));
const isUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//.test(u);

export async function exportSite(o: ExportOptions): Promise<ExportResult> {
  const result: ExportResult = { outDir: o.outDir, mods: [], warnings: [] };
  clearOutDir(o.outDir, [o.pagesDir, ...[...o.zips.values()].map((z) => z.path)]);
  const index: SourceIndexFile = { format: 1, generator: "vsdev moddb export", mods: [] };
  const pages: PageData[] = [];

  for (const modid of o.modids) {
    const modDir = path.join(o.pagesDir, modid);
    const local = readLocal(modDir);
    const warn = (msg: string) => result.warnings.push(`${modid}: ${msg}`);
    let page: Record<string, unknown> = {};
    try {
      page = JSON.parse(local[PAGE_JSON] ?? "{}");
    } catch (err) {
      warn(`page.json is not valid JSON (${(err as Error).message}); exported with defaults`);
    }
    for (const [name, text] of Object.entries(local)) if (name.endsWith(".html") && text.includes(PLACEHOLDER)) warn(`${name} still has ${PLACEHOLDER} placeholder text (published as is)`);

    let live: LiveMod | null = null;
    let asked = false;
    if (o.client) {
      try {
        live = await o.client.mod(modid);
        asked = true;
      } catch (err) {
        warn(`couldn't ask ModDB (${(err as Error).message}); nothing is marked as on ModDB`);
      }
    }
    const onModDb = new Set(live?.releases.map((r) => r.version) ?? []);
    const alias = typeof page.urlalias === "string" && page.urlalias ? page.urlalias : null;
    const modDbUrl = live?.assetId ? `https://mods.vintagestory.at/show/mod/${live.assetId}` : alias ? `https://mods.vintagestory.at/${alias}` : null;

    const outMod = path.join(o.outDir, modid);
    mkdirSync(outMod, { recursive: true });
    const files: string[] = [];

    // Images named in page.json, from moddb/<modid>/images/.
    const copyImage = (name: string | null) => {
      if (!name) return null;
      const from = path.join(modDir, IMAGES_DIR, path.basename(name));
      if (!existsSync(from)) {
        warn(`${IMAGES_DIR}/${name} is named in page.json but missing; left out`);
        return null;
      }
      mkdirSync(path.join(outMod, IMAGES_DIR), { recursive: true });
      copyFileSync(from, path.join(outMod, IMAGES_DIR, path.basename(name)));
      return path.basename(name);
    };
    const logo = copyImage(typeof page.logo === "string" ? page.logo : null);
    const screenshots = (Array.isArray(page.screenshots) ? page.screenshots : []).map((s) => copyImage(String(s))).filter((s): s is string => !!s);

    // Releases: every releases/<v>.json, plus the zip's version; newest first.
    const versions = new Set(Object.keys(local).filter((k) => k.startsWith("releases/") && k.endsWith(".json")).map((k) => path.posix.basename(k, ".json")));
    const zip = o.zips.get(modid);
    if (zip) versions.add(zip.version);
    else warn("no zip in Releases/: the page has nothing to download");
    const key = (v: string) => parseTriple(v) ?? [0, 0, 0];
    const releases: PageData["releases"] = [];
    const sourceReleases: SourceRelease[] = [];
    for (const v of [...versions].sort((a, b) => compareTriple(key(b), key(a)))) {
      let games: string[] = [];
      try {
        const rel = JSON.parse(local[`releases/${v}.json`] ?? "{}") as { gameVersions?: unknown };
        if (Array.isArray(rel.gameVersions)) games = rel.gameVersions.map(String);
      } catch {
        warn(`releases/${v}.json is not valid JSON`);
      }
      const entry: PageData["releases"][number] = { version: v, gameVersions: games, changelog: local[releaseHtmlPath(v)] ?? "", onModDb: onModDb.has(v) };
      if (zip && zip.version === v) {
        if (!games.length && zip.gameVersion) entry.gameVersions = games = [zip.gameVersion];
        const data = readFileSync(zip.path);
        const target = `files/${zip.file}`;
        mkdirSync(path.join(outMod, "files"), { recursive: true });
        writeFileSync(path.join(outMod, target), data);
        files.push(target);
        entry.file = { name: zip.file, size: data.length };
        let dependencies: Record<string, string> = {};
        try {
          const text = modInfoFromZip(data).text;
          if (text) dependencies = Object.fromEntries(parseModInfo(text).dependencies.map((d) => [d.modid, d.version]));
        } catch {
          warn(`${zip.file}: its modinfo.json couldn't be read; mods.json lists no dependencies for it`);
        }
        sourceReleases.push({ version: v, gameVersions: games, file: `${modid}/${target}`, sha256: sha256(data), size: data.length, dependencies, ...(asked ? { onModDb: entry.onModDb } : {}) });
      }
      releases.push(entry);
    }

    const links: PageData["links"] = [];
    for (const [k, label] of [["homepageurl", "Homepage"], ["sourcecodeurl", "Source code"], ["issuetrackerurl", "Issue tracker"], ["wikiurl", "Wiki"], ["trailervideourl", "Trailer"]] as const) {
      if (isUrl(page[k])) links.push({ label, url: page[k] as string });
    }
    const data: PageData = {
      modid, name: typeof page.name === "string" && page.name ? page.name : zip?.name ?? modid,
      side: typeof page.side === "string" ? page.side : "both", type: typeof page.type === "string" ? page.type : "mod",
      links, tags: Array.isArray(page.tags) ? page.tags.map(String) : [], logo, screenshots,
      description: local[DESCRIPTION] ?? "", releases, modDbUrl, checked: asked,
    };
    pages.push(data);
    writeFileSync(path.join(outMod, "index.html"), modPage(data, o.title));
    const sourceMod: SourceMod = { modid, name: data.name, side: data.side, page: `${modid}/`, releases: sourceReleases };
    index.mods.push(sourceMod);
    result.mods.push({ modid, page: `${modid}/index.html`, files });
  }

  writeFileSync(path.join(o.outDir, "index.html"), indexPage(pages, o.title));
  writeFileSync(path.join(o.outDir, "mods.json"), `${JSON.stringify(index, null, 2)}\n`);
  writeFileSync(path.join(o.outDir, "style.css"), STYLE);
  writeFileSync(path.join(o.outDir, ".nojekyll"), "");
  return result;
}

/**
 * Empties the output folder, but only when that is safe: it doesn't exist, is empty, or holds a previous export (a mods.json written by
 * this command). It must not contain the pages folder or a zip it reads. Anything else is refused rather than deleted.
 */
function clearOutDir(outDir: string, inputs: string[]): void {
  const out = path.resolve(outDir);
  for (const input of inputs) {
    const rel = path.relative(out, path.resolve(input));
    if (!rel || (!rel.startsWith("..") && !path.isAbsolute(rel))) throw new Error(`--out ${outDir} contains ${input}, which the export reads; pick an empty folder`);
  }
  if (existsSync(out) && readdirSync(out).length) {
    let ours = false;
    try {
      ours = (JSON.parse(readFileSync(path.join(out, "mods.json"), "utf8")) as { generator?: string }).generator === "vsdev moddb export";
    } catch {
      // no readable mods.json: not a previous export
    }
    if (!ours) throw new Error(`--out ${outDir} isn't empty and isn't a previous vsdev export; refusing to delete it (pick another folder)`);
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });
}

const latestDownload = (p: PageData) => p.releases.find((r) => r.file);

function shell(title: string, body: string, root: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${root}style.css">
</head>
<body>
${body}
<footer>Made with <code>vsdev moddb export</code>. Not affiliated with Anego Studios or mods.vintagestory.at.</footer>
</body>
</html>
`;
}

function indexPage(pages: PageData[], title = "Vintage Story mods"): string {
  const cards = pages.map((p) => {
    const latest = latestDownload(p);
    return `<a class="card" href="${esc(p.modid)}/">
  ${p.logo ? `<img src="${esc(p.modid)}/images/${esc(p.logo)}" alt="" loading="lazy">` : `<div class="noimg"></div>`}
  <div class="cardbody"><h2>${esc(p.name)}</h2>
  <div class="meta">${esc(sideLabel[p.side] ?? p.side)}${latest ? ` · v${esc(latest.version)}` : ""}${latest && p.checked && !latest.onModDb ? ` · <span class="new">not on ModDB yet</span>` : ""}</div>
  <div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")}</div></div>
</a>`;
  }).join("\n");
  return shell(title, `<header><h1>${esc(title)}</h1></header>
<main><div class="grid">
${cards || "<p>No mods exported.</p>"}
</div></main>`, "");
}

function modPage(p: PageData, siteTitle = "Vintage Story mods"): string {
  const latest = latestDownload(p);
  const id = esc(p.modid);
  const download = latest?.file ? `<section class="download">
  <h2>Download</h2>
  <p><a class="button" href="files/${esc(encodeURIComponent(latest.file.name))}" download>${esc(latest.file.name)}</a>
  <span class="meta">v${esc(latest.version)} · ${esc(size(latest.file.size))}${latest.gameVersions.length ? ` · for ${esc(gameRange(latest.gameVersions))}` : ""}${p.checked && !latest.onModDb ? " · not on ModDB yet" : ""}</span></p>
  <p>Put the zip in your Vintage Story <code>Mods</code> folder (don't unpack it): on Windows <code>%APPDATA%\\VintagestoryData\\Mods</code>,
  on Linux <code>~/.config/VintagestoryData/Mods</code>, on macOS <code>~/Library/Application Support/VintagestoryData/Mods</code>.</p>
  <p>Or with <a href="https://github.com/jgwoolley/vintage-story-wiki/tree/main/apps/vsdev">vsdev</a>, which also installs its dependencies:</p>
  <div class="cmd"><code id="install-cmd">vsdev mod install ${id} --source &lt;this site&gt;</code><button type="button" id="copy-cmd">Copy</button></div>
  <script>
    (() => {
      const site = new URL("..", location.href).href;
      const cmd = document.getElementById("install-cmd");
      cmd.textContent = "vsdev mod install ${id} --source " + site;
      document.getElementById("copy-cmd").onclick = (e) => navigator.clipboard.writeText(cmd.textContent).then(() => { e.target.textContent = "Copied"; });
    })();
  </script>
</section>` : "";
  const gallery = p.screenshots.length ? `<section class="gallery">${p.screenshots.map((s) => `<a href="images/${esc(encodeURIComponent(s))}"><img src="images/${esc(encodeURIComponent(s))}" alt="Screenshot ${esc(s)}" loading="lazy"></a>`).join("")}</section>` : "";
  const releases = p.releases.length ? `<section class="releases"><h2>Files</h2><table>
<tr><th>Version</th><th>Game versions</th><th></th></tr>
${p.releases.map((r) => `<tr><td>${esc(r.version)}</td><td title="${esc(r.gameVersions.join(", "))}">${esc(gameRange(r.gameVersions) || "-")}</td><td>${r.file ? `<a href="files/${esc(encodeURIComponent(r.file.name))}" download>${esc(r.file.name)}</a>` : r.onModDb && p.modDbUrl ? `<a href="${esc(p.modDbUrl)}">on ModDB</a>` : ""}</td></tr>
${r.changelog.trim() ? `<tr class="changelog"><td colspan="3"><details${r === p.releases[0] ? " open" : ""}><summary>Changelog</summary><div class="html">${r.changelog}</div></details></td></tr>` : ""}`).join("\n")}
</table></section>` : "";
  return shell(`${p.name} - ${siteTitle}`, `<header><a href="../">${esc(siteTitle)}</a></header>
<main>
<div class="head">
  ${p.logo ? `<img class="logo" src="images/${esc(encodeURIComponent(p.logo))}" alt="">` : ""}
  <div><h1>${esc(p.name)}</h1>
  <div class="meta">${esc(sideLabel[p.side] ?? p.side)} · modid <code>${id}</code>${p.modDbUrl ? ` · <a href="${esc(p.modDbUrl)}">on ModDB</a>` : ""}</div>
  <div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")}</div>
  ${p.links.length ? `<div class="links">${p.links.map((l) => `<a href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`).join(" · ")}</div>` : ""}</div>
</div>
${gallery}
<section class="description html">${p.description}</section>
${download}
${releases}
</main>`, "../");
}

const STYLE = `:root { color-scheme: light dark; --bg:#f6f3ec; --fg:#2b2622; --muted:#6d655c; --card:#fffdf8; --line:#d9d1c4; --accent:#5b7d3a; --new:#b5651d; }
@media (prefers-color-scheme: dark) { :root { --bg:#1f1d1a; --fg:#ece6dc; --muted:#a59c90; --card:#2a2723; --line:#433e37; --accent:#8fb866; --new:#e0a060; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 system-ui, sans-serif; }
header { padding:12px 24px; border-bottom:1px solid var(--line); background:var(--card); }
header h1 { margin:0; font-size:22px; } header a { color:var(--fg); font-weight:600; text-decoration:none; }
main { max-width:1000px; margin:0 auto; padding:20px 24px 40px; }
a { color:var(--accent); }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:16px; }
.card { display:block; background:var(--card); border:1px solid var(--line); border-radius:8px; overflow:hidden; color:inherit; text-decoration:none; }
.card:hover { border-color:var(--accent); }
.card img, .card .noimg { width:100%; aspect-ratio:1; object-fit:cover; display:block; background:var(--line); }
.cardbody { padding:10px 12px; } .card h2 { margin:0 0 4px; font-size:16px; }
.meta { color:var(--muted); font-size:13px; } .new { color:var(--new); }
.tags { margin-top:6px; } .tag { display:inline-block; font-size:12px; padding:1px 8px; border-radius:10px; border:1px solid var(--line); margin:0 4px 4px 0; }
.head { display:flex; gap:18px; align-items:flex-start; margin-bottom:16px; } .head h1 { margin:0 0 4px; }
.logo { width:128px; height:128px; border-radius:8px; border:1px solid var(--line); object-fit:cover; }
.links { margin-top:6px; }
.gallery { display:flex; gap:10px; overflow-x:auto; margin:10px 0 18px; } .gallery img { height:180px; border-radius:6px; border:1px solid var(--line); }
section { margin:18px 0; } h2 { font-size:18px; border-bottom:1px solid var(--line); padding-bottom:4px; }
.html img { max-width:100%; }
.download { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:4px 16px 12px; }
.button { display:inline-block; background:var(--accent); color:#fff; padding:6px 14px; border-radius:6px; text-decoration:none; font-weight:600; margin-right:8px; }
.cmd { display:flex; gap:8px; align-items:center; } .cmd code { flex:1; overflow-x:auto; white-space:nowrap; }
code { background:var(--line); padding:1px 5px; border-radius:4px; font-size:13px; }
button { font:inherit; padding:3px 10px; border:1px solid var(--line); border-radius:6px; background:var(--card); color:inherit; cursor:pointer; }
table { border-collapse:collapse; width:100%; } th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
tr.changelog td { border-bottom:1px solid var(--line); padding-top:0; } summary { cursor:pointer; color:var(--muted); }
footer { text-align:center; color:var(--muted); font-size:12px; padding:20px; }
`;
