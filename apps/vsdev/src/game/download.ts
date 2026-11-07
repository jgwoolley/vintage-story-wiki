// Downloading the Vintage Story dedicated server (what the wiki ingests, and what a mod project can build and test a server against) from
// the game's CDN: cdn.vintagestory.at/gamefiles/<branch>/vs_server_linux-x64_<version>.tar.gz. It goes to the game install location
// (./vintagestory by default, see src/locations.ts); a .vsdev-game.json marker records what vsdev put there, so it can change the version
// later without touching installs it didn't make. Download to a temp file and extract into a temp folder next to the target, and only
// then replace the old install, so a wrong version or a dropped connection never deletes a working one. Pure-JS `tar`, no system binary.
//
// THE CLIENT IS DELIBERATELY NOT DOWNLOADED. We know where it is: the same CDN path with `vs_client_linux-x64_` (a tarball with
// everything under one top-level `vintagestory/` folder; translocator-locator-cmd's old extract.sh fetched it). But the client is the
// paid game: Anego Studios' Terms of Service (https://www.vintagestory.at/tos.html) frame downloading it as part of an account that bought
// it (the Client Area, https://account.vintagestory.at/), and an address that answers without a login is not permission. Until the
// Vintage Story developers confirm that fetching it this way is acceptable (we may ask them), tools that need the client (textures,
// DLLs) use the copy the user installed: --game-dir, $VINTAGE_STORY, ./vintagestory, or the default install location. Don't add it back
// without that confirmation. The same question could be asked about the server download, which this repo has always used.
import { createWriteStream, existsSync, readdirSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { GAME_MARKER, gameInfo, readGameMarker, type GameMarker } from "../locations.js";
import type { DownloadAction } from "../types.js";

/** What a game install holds (gameInfo tells them apart); only the server is ever downloaded. */
export type GameKind = "server" | "client";

/** A download that failed for an expected reason (no such version, network); the old install is untouched. */
export class GameDownloadError extends Error {}

/** Why `--client` / `"gameKind": "client"` doesn't download anything, for the commands to print. */
export const CLIENT_NOT_DOWNLOADED = `vsdev doesn't download the game client: it's the paid game, downloaded from your account (buy it at
https://www.vintagestory.at/store/category/1-game-account-game-servers/, then get the installer from the Client Area,
https://account.vintagestory.at/). Install it there, then point vsdev and the mod template's builds at it:
  export VINTAGE_STORY=/path/to/your/game     (Linux default: ~/.local/share/vintagestory, Windows: %APPDATA%\\Vintagestory)
vsdev also finds it by itself in those default locations, and in ./vintagestory. \`vsdev game --server\` downloads the dedicated
server, which has the game's data but not its textures.`;

export interface GameOptions {
  /** "stable" or "unstable". */
  branch: string;
  version: string;
  dir: string;
  force: boolean;
  fetchImpl?: typeof fetch;
  /** Called with bytes so far and the total (0 if unknown). */
  onProgress?: (done: number, total: number) => void;
  log?: (line: string) => void;
}

export const serverUrl = (branch: string, version: string) => `https://cdn.vintagestory.at/gamefiles/${branch}/vs_server_linux-x64_${version}.tar.gz`;

export type GamePlan = { action: "install" | "replace" | "skip" | "refuse"; reason: string };

/**
 * What to do with `dir` when asked for the server `version` (without --force, which always installs):
 * - empty or missing: install;
 * - a game install of that version (a server, or a client, which includes the server): skip;
 * - a client of another version: refuse (a server would replace it with less: no textures, no game executable);
 * - a server vsdev installed (it has .vsdev-game.json): replace it with the other version;
 * - anything else (an install vsdev didn't make, or other files): skip, and say --force replaces it.
 */
export function planGameInstall(dir: string, version: string): GamePlan {
  if (!existsSync(dir) || readdirSync(dir).length === 0) return { action: "install", reason: "empty" };
  const info = gameInfo(dir);
  const label = info ? `${info.kind}${info.version ? ` ${info.version}` : ""}` : "files that aren't a game install";
  if (info && info.version === version) {
    return { action: "skip", reason: `${dir}/ already has the ${label}${info.kind === "client" ? " (which includes the server)" : ""}` };
  }
  if (info?.kind === "client") {
    return { action: "refuse", reason: `${dir}/ has the game client ${info.version ?? ""}; a server ${version} would replace it with less (no textures). Pick another --game-dir, or --force` };
  }
  if (readGameMarker(dir)) return { action: "replace", reason: `replacing the ${label} vsdev installed there` };
  return { action: "skip", reason: `${dir}/ has ${label}, not installed by vsdev; leaving it alone (--force replaces it)` };
}

/** Installs the dedicated server into `dir` (see planGameInstall for when an existing folder is skipped, replaced or refused). */
export async function installServer(opts: GameOptions): Promise<DownloadAction> {
  const { branch, version, dir, force, fetchImpl = fetch, onProgress, log = console.log } = opts;
  if (!force) {
    const plan = planGameInstall(dir, version);
    if (plan.action === "skip") {
      log(`- ${plan.reason}`);
      return "skipped-present";
    }
    if (plan.action === "refuse") throw new GameDownloadError(plan.reason);
    if (plan.action === "replace") log(`- ${plan.reason}`);
  }
  const url = serverUrl(branch, version);
  const parent = path.dirname(path.resolve(dir));
  const base = path.basename(path.resolve(dir));
  const archive = path.join(parent, `.${base}.download.tar.gz`);
  const staging = path.join(parent, `.${base}.extracting`);
  await mkdir(parent, { recursive: true });

  log(`==> Downloading the Vintage Story server ${version} (${branch})`);
  const res = await fetchImpl(url).catch((err: Error) => {
    throw new GameDownloadError(`${url}: ${err.message}`);
  });
  if (!res.ok || !res.body) {
    throw new GameDownloadError(`${url}: HTTP ${res.status}${res.status === 404 ? ` (no server ${version} on the ${branch} branch?)` : ""}`);
  }
  const total = Number(res.headers.get("content-length")) || 0;
  let done = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      done += chunk.length;
      onProgress?.(done, total);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(archive));
    log(`==> Extracting to ${dir}/`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    await tar.extract({ file: archive, cwd: staging }); // the server tarball is flat
    const marker: GameMarker = { kind: "server", version, branch, url, installedAt: new Date().toISOString() };
    await writeFile(path.join(staging, GAME_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
    await rm(dir, { recursive: true, force: true });
    await rename(staging, dir);
  } finally {
    await rm(archive, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
  log(`✔ Server installed in ${dir}/`);
  return "downloaded";
}
