// A vs-manifest.json (this repo's own, or a mod project's): the game version to install and the mods to pin. Its location fields
// (gameDir, gameKind, dataDir, releasesDir, pagesDir) are read by src/locations.ts.
//   { "serverBranch": "stable", "serverVersion": "1.22.7", "mods": [{ "modid": "betterruins", "version": "0.6.4" }, ...] }
// `vsdev download` installs the server and every mod; the wiki's `npm run download` (apps/vs-wiki/scripts/download.ts) calls
// installManifestMod itself so it can also record each mod's ModDB listing (.meta.json) and timings.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readLocalMod, removeLocalMod, scanLocalMods } from "../mods/local.js";
import { blockReason, formatSpec, parseModSpec, type ModDb, type ModDbMod, type ModDbRelease } from "../mods/moddb.js";
import type { DownloadAction } from "../types.js";

export interface Manifest {
  serverBranch: string;
  serverVersion: string;
  /** "modid" or "modid@version". */
  mods: string[];
  /** modid (lower case) -> direct download link, for the entries that give a `url` (a draft mod the API doesn't list). */
  urls: Map<string, string>;
}

/** Reads a manifest; missing fields get the defaults (stable, 1.22.7, no mods). `gameVersion` and `serverVersion` mean the same. */
export function readManifest(file: string): Manifest {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { serverBranch?: string; serverVersion?: string; gameVersion?: string; mods?: { modid: string; version?: string; url?: string }[] };
  return {
    serverBranch: raw.serverBranch ?? "stable",
    serverVersion: raw.gameVersion ?? raw.serverVersion ?? "1.22.7",
    mods: (raw.mods ?? []).map((m) => formatSpec(m.modid, m.version)),
    urls: new Map((raw.mods ?? []).filter((m) => m.url).map((m) => [m.modid.toLowerCase(), m.url!])),
  };
}

export interface ManifestModResult {
  action: DownloadAction;
  /** The ModDB listing, when the lookup worked (the wiki caches assetid/urlalias/logo from it). */
  mod?: ModDbMod;
  release?: ModDbRelease;
  file?: string;
  /** Other zips of the same modid removed from `modsDir` (file names): a bumped pin replaces the old zip rather than joining it. */
  removed?: string[];
  /** Why it failed. */
  error?: string;
}

/**
 * Installs one pinned (or unpinned) mod into `modsDir` without dependency resolution: the exact release asked for, or (unpinned) ModDB's
 * pick for `gameVersion`, else the newest release. A file already there under the release's name is kept unless `force`. With `url` (the
 * manifest entry's direct download link) the API isn't asked at all: a draft mod's page and files are public, but the API 404s on it.
 */
export async function installManifestMod(
  spec: string,
  { db, modsDir, force = false, gameVersion, url, log = console.log }: { db: ModDb; modsDir: string; force?: boolean; gameVersion?: string; url?: string; log?: (line: string) => void },
): Promise<ManifestModResult> {
  const { id, version } = parseModSpec(spec);
  if (url) return installFromUrl(id, version, url, { db, modsDir, force, log });
  log(`==> Looking up mod '${id}'${version ? ` version ${version}` : ""}`);
  const mod = await db.mod(id);
  if (!mod) return { action: "failed", error: `Could not find mod '${id}' on mods.vintagestory.at` };
  const releases = mod.releases ?? [];
  let wanted = version;
  if (!wanted && gameVersion) wanted = (await db.installInfo([id], gameVersion)).data[id]?.recommendedUpgrade;
  const release = wanted ? releases.find((r) => r.modversion === wanted) : releases[0];
  if (!release) {
    const available = releases.slice(0, 10).map((r) => r.modversion).join(", ") + (releases.length > 10 ? ", ..." : "");
    return { action: "failed", mod, error: `Could not find mod '${id}'${wanted ? ` version ${wanted}` : ""} on mods.vintagestory.at${releases.length ? `\n  Available versions: ${available}` : ""}` };
  }
  const blocked = blockReason(await db.blocked(), release.modidstr ?? id, release.modversion);
  if (blocked) return { action: "failed", mod, release, error: `${id}@${release.modversion} is on the game's blocklist: ${blocked}` };

  const dest = path.join(modsDir, path.basename(release.filename));
  if (!force && existsSync(dest)) {
    log(`- Mod already present: ${dest} (use --force to re-download)`);
    return { action: "skipped-present", mod, release, file: dest, removed: removeOtherCopies(modsDir, dest, log) };
  }
  log(`==> Downloading mod ${release.filename}`);
  await db.download(release.mainfile, dest);
  log(`✔ Mod saved to ${dest}`);
  return { action: "downloaded", mod, release, file: dest, removed: removeOtherCopies(modsDir, dest, log) };
}

/** The file name a direct link saves under: ModDB's `?dl=` name (its CDN links carry one), else the link's last path segment. */
export function urlFileName(url: string): string {
  const u = new URL(url);
  return path.basename(u.searchParams.get("dl") || decodeURIComponent(u.pathname));
}

async function installFromUrl(
  id: string,
  version: string | undefined,
  url: string,
  { db, modsDir, force, log }: { db: ModDb; modsDir: string; force: boolean; log: (line: string) => void },
): Promise<ManifestModResult> {
  const name = urlFileName(url);
  if (!/\.zip$/i.test(name)) return { action: "failed", error: `${id}: ${url} doesn't name a .zip file` };
  const dest = path.join(modsDir, name);
  const check = (): string | undefined => {
    const info = readLocalMod(modsDir, name)?.info;
    if (info?.modid?.toLowerCase() !== id.toLowerCase()) return `${name} is mod '${info?.modid ?? "?"}', not '${id}'`;
    if (version && info.version !== version) return `${name} is ${id} version ${info.version}, not the pinned ${version}`;
    return undefined;
  };
  const present = !force && existsSync(dest);
  if (present) {
    log(`- Mod already present: ${dest} (use --force to re-download)`);
  } else {
    log(`==> Downloading mod ${id} from ${url}`);
    await db.download(url, dest);
    log(`✔ Mod saved to ${dest}`);
  }
  const wrong = check();
  if (wrong) return { action: "failed", file: dest, error: wrong };
  return { action: present ? "skipped-present" : "downloaded", file: dest, removed: removeOtherCopies(modsDir, dest, log) };
}

/**
 * Removes the zips in `modsDir` whose modinfo.json names the same modid as `keep` (any version: the manifest pins exactly one). The
 * modid comes from each zip's modinfo.json, not its file name (`BetterRuinsv0.6.4.zip`). Only zips: a folder may be a mod's
 * working copy, and .dll/.cs mods can't be read. Nothing is removed when `keep` itself can't be read.
 */
function removeOtherCopies(modsDir: string, keep: string, log: (line: string) => void): string[] {
  const modid = readLocalMod(modsDir, path.basename(keep))?.info?.modid?.toLowerCase();
  if (!modid) return [];
  const removed: string[] = [];
  for (const other of scanLocalMods(modsDir)) {
    if (other.kind !== "zip" || path.resolve(other.path) === path.resolve(keep) || other.info?.modid?.toLowerCase() !== modid) continue;
    removeLocalMod(other);
    removed.push(other.source);
    log(`- Removed ${other.source} (${other.info.modid} v${other.info.version}, replaced by ${path.basename(keep)})`);
  }
  return removed;
}
