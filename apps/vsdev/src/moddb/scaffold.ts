// Placeholder moddb/<modid>/ files for a mod with no live page yet, so there is something to write before the first upload: a port of
// ModDbCli's Scaffolder.cs. Name, side and the first line of the description come from the zip's modinfo.json; the description and the
// changelog get TODO: placeholders (`vsdev moddb diff --fail-if-placeholders` exits 1 until they're replaced). Also puts
// page.schema.json in the pages folder when it isn't there, so editors validate page.json.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { buildRelease, DESCRIPTION, dumpJson, PAGE_JSON, PLACEHOLDER, releaseHtmlPath, releaseJsonPath, SCHEMA_FILE, writeText } from "./files.js";
import type { ReleaseZip } from "./releases.js";
import { bundledSchemaPath } from "./validate.js";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Writes the placeholder files; returns the paths written (relative to the mod folder). Existing files are kept unless `force`. */
export function scaffold(zip: ReleaseZip, modDir: string, sourceCodeUrl: string, force: boolean): string[] {
  const written: string[] = [];
  const write = (relative: string, text: string) => {
    const file = path.join(modDir, relative);
    if (existsSync(file) && !force) return;
    writeText(file, text);
    written.push(relative);
  };
  write(PAGE_JSON, dumpJson({
    modid: zip.modid, moddbId: null, urlalias: null, name: zip.name || zip.modid, side: sideOf(zip.side), type: "mod",
    homepageurl: "", sourcecodeurl: sourceCodeUrl, trailervideourl: "", issuetrackerurl: "", wikiurl: "",
    tags: [], logo: null, screenshots: [],
  }));
  const summary = zip.description?.trim() ? `<p>${escapeHtml(zip.description.trim())}</p>\n` : "";
  write(DESCRIPTION, `${summary}<p>${PLACEHOLDER} write the mod page description.</p>\n`);
  write(releaseJsonPath(zip.version), dumpJson(buildRelease(zip.version, zip.gameVersion ? [zip.gameVersion] : [], zip.file)));
  write(releaseHtmlPath(zip.version), `<p>${PLACEHOLDER} changelog for ${escapeHtml(zip.version)}.</p>\n`);
  return written;
}

/** Copies the bundled page.schema.json into the pages folder if it has none; returns whether it did. */
export function ensureSchema(pagesDir: string): boolean {
  const target = path.join(pagesDir, SCHEMA_FILE);
  if (existsSync(target)) return false;
  mkdirSync(pagesDir, { recursive: true });
  copyFileSync(bundledSchemaPath(), target);
  return true;
}

/** modinfo.json side (Client, Server, Universal) to the site's client/server/both. */
export function sideOf(side: string | undefined): "both" | "client" | "server" {
  const s = side?.trim().toLowerCase();
  return s === "client" ? "client" : s === "server" ? "server" : "both";
}

/** The https URL of the working directory's git "origin" remote, or "" without git or a remote. */
export function sourceCodeUrl(cwd: string): string {
  try {
    return toHttps(execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return "";
  }
}

/** git@host:owner/repo.git and ssh://git@host/owner/repo.git to https://host/owner/repo. */
export function toHttps(remote: string): string {
  let r = remote.trim();
  const colon = r.indexOf(":");
  if (r.startsWith("git@") && colon > 0) r = `https://${r.slice(4, colon)}/${r.slice(colon + 1)}`;
  else if (r.startsWith("ssh://git@")) r = `https://${r.slice("ssh://git@".length)}`;
  return r.endsWith(".git") ? r.slice(0, -4) : r;
}
