// The one place that knows the moddb/<modid>/ layout: a port of ModDbCli's PageFiles.cs, byte for byte where it matters (key order,
// indentation, trailing newlines), so a folder written by either tool compares equal. Volatile values (downloads, follows, comments,
// timestamps, CDN urls) are left out on purpose so that a diff only shows real changes.
//
//   page.json                 modid, moddbId, [moddbPageId], urlalias, name, side, type, the five links, tags (sorted), logo, screenshots
//   description.html          the page description, as the HTML the site stores
//   releases/<version>.json   version, gameVersions (sorted), filename
//   releases/<version>.html   that release's changelog
//   images/                   logo.<ext> and the screenshots (also where you keep them before the first upload)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compareTriple, parseTriple } from "./checks.js";
import type { LiveMod } from "./live.js";

export const PAGE_JSON = "page.json";
export const DESCRIPTION = "description.html";
export const IMAGES_DIR = "images";
export const SCHEMA_FILE = "page.schema.json";
export const PLACEHOLDER = "TODO:";

export const releaseJsonPath = (version: string) => `releases/${version}.json`;
export const releaseHtmlPath = (version: string) => `releases/${version}.html`;

/** Line endings normalized, surrounding whitespace trimmed; ends with one newline (or is empty). */
export function tidyHtml(text: string | null | undefined): string {
  const tidy = (text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return tidy ? `${tidy}\n` : "";
}

/** Indented with two spaces and "\n", plus a final newline (System.Text.Json WriteIndented with relaxed escaping). */
export const dumpJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const extOf = (p: string) => path.posix.extname(p).toLowerCase();

/** "logo.<ext>" from the logo URL (the site's hashed CDN name isn't stored), or null when the page has none. */
export function logoName(mod: Pick<LiveMod, "logoUrl">): string | null {
  if (!mod.logoUrl) return null;
  let p = mod.logoUrl;
  try {
    p = new URL(mod.logoUrl).pathname;
  } catch {
    // a relative path: use as is
  }
  return p ? `logo${extOf(p)}` : null;
}

const byLower = (a: string, b: string) => {
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** page.json's object, in ModDbCli's key order (`moddbPageId` only when the page is a draft read from its HTML). */
export function buildPage(modid: string, mod: LiveMod): Record<string, unknown> {
  const page: Record<string, unknown> = {
    modid,
    moddbId: mod.modDbId ?? null,
    moddbPageId: mod.pageId ?? null,
    urlalias: mod.urlAlias ?? null,
    name: mod.name ?? null,
    side: mod.side ?? null,
    type: mod.type ?? null,
    homepageurl: mod.homepageUrl ?? null,
    sourcecodeurl: mod.sourceCodeUrl ?? null,
    trailervideourl: mod.trailerVideoUrl ?? null,
    issuetrackerurl: mod.issueTrackerUrl ?? null,
    wikiurl: mod.wikiUrl ?? null,
    tags: [...mod.tags].sort(byLower),
    logo: logoName(mod),
    screenshots: mod.screenshots.map((s) => s.fileName),
  };
  if (mod.pageId == null) delete page.moddbPageId;
  return page;
}

/** releases/<version>.json's object; game versions sorted by MAJOR.MINOR.PATCH (stable, so pre-releases keep the site's order). */
export function buildRelease(version: string, gameVersions: string[], fileName: string | null | undefined): Record<string, unknown> {
  const key = (v: string) => parseTriple(v) ?? [0, 0, 0];
  return { version, gameVersions: [...gameVersions].sort((a, b) => compareTriple(key(a), key(b))), filename: fileName ?? null };
}

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedRecord = (entries: [string, string][]) => Object.fromEntries(entries.sort((a, b) => ordinal(a[0], b[0])));

/** The text files (path relative to the mod folder -> content) for a live mod. */
export function buildFiles(modid: string, mod: LiveMod): Record<string, string> {
  const entries: [string, string][] = [[PAGE_JSON, dumpJson(buildPage(modid, mod))], [DESCRIPTION, tidyHtml(mod.text)]];
  for (const r of mod.releases) {
    entries.push([releaseJsonPath(r.version), dumpJson(buildRelease(r.version, r.gameVersions, r.fileName))]);
    entries.push([releaseHtmlPath(r.version), tidyHtml(r.changelog)]);
  }
  return sortedRecord(entries);
}

/** Path relative to the mod folder -> CDN url, for the logo and the screenshots. */
export function imageUrls(mod: LiveMod): Record<string, string> {
  const entries: [string, string][] = [];
  const logo = logoName(mod);
  if (logo && mod.logoUrl) entries.push([`${IMAGES_DIR}/${logo}`, mod.logoUrl]);
  for (const s of mod.screenshots) entries.push([`${IMAGES_DIR}/${path.posix.basename(s.fileName)}`, s.url]);
  return sortedRecord(entries);
}

/** The text files of a mod folder (images/, a root README.md and dotfiles such as .gitignore left out). */
export function readLocal(modDir: string): Record<string, string> {
  const entries: [string, string][] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const relative = path.relative(modDir, full).split(path.sep).join("/");
      if (relative === "README.md" || name.startsWith(".") || relative.startsWith(`${IMAGES_DIR}/`)) continue;
      entries.push([relative, readFileSync(full, "utf8")]);
    }
  };
  walk(modDir);
  return sortedRecord(entries);
}

/** Writes UTF-8 without a BOM, creating the folder. */
export function writeText(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
