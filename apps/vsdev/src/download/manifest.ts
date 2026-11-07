// A vs-manifest.json (this repo's own, or a mod project's): the game version to install and the mods to pin. Its location fields
// (gameDir, gameKind, dataDir, releasesDir, pagesDir) are read by src/locations.ts.
//   { "serverBranch": "stable", "serverVersion": "1.22.7", "mods": [{ "modid": "betterruins", "version": "0.6.4" }, ...] }
// `vsdev download` installs the server and every mod; the wiki's `npm run download` (apps/vs-wiki/scripts/download.ts) calls
// installManifestMod itself so it can also record each mod's ModDB listing (.meta.json) and timings.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { blockReason, formatSpec, parseModSpec, type ModDb, type ModDbMod, type ModDbRelease } from "../mods/moddb.js";
import type { DownloadAction } from "../types.js";

export interface Manifest {
  serverBranch: string;
  serverVersion: string;
  /** "modid" or "modid@version". */
  mods: string[];
}

/** Reads a manifest; missing fields get the defaults (stable, 1.22.7, no mods). `gameVersion` and `serverVersion` mean the same. */
export function readManifest(file: string): Manifest {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { serverBranch?: string; serverVersion?: string; gameVersion?: string; mods?: { modid: string; version?: string }[] };
  return {
    serverBranch: raw.serverBranch ?? "stable",
    serverVersion: raw.gameVersion ?? raw.serverVersion ?? "1.22.7",
    mods: (raw.mods ?? []).map((m) => formatSpec(m.modid, m.version)),
  };
}

export interface ManifestModResult {
  action: DownloadAction;
  /** The ModDB listing, when the lookup worked (the wiki caches assetid/urlalias/logo from it). */
  mod?: ModDbMod;
  release?: ModDbRelease;
  file?: string;
  /** Why it failed. */
  error?: string;
}

/**
 * Installs one pinned (or unpinned) mod into `modsDir` without dependency resolution: the exact release asked for, or (unpinned) ModDB's
 * pick for `gameVersion`, else the newest release. A file already there under the release's name is kept unless `force`.
 */
export async function installManifestMod(
  spec: string,
  { db, modsDir, force = false, gameVersion, log = console.log }: { db: ModDb; modsDir: string; force?: boolean; gameVersion?: string; log?: (line: string) => void },
): Promise<ManifestModResult> {
  const { id, version } = parseModSpec(spec);
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
    return { action: "skipped-present", mod, release, file: dest };
  }
  log(`==> Downloading mod ${release.filename}`);
  await db.download(release.mainfile, dest);
  log(`✔ Mod saved to ${dest}`);
  return { action: "downloaded", mod, release, file: dest };
}
