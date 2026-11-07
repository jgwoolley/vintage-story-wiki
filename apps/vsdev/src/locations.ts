// Where the game, its data (Mods) and a mod project's files are, with one rule for every vsdev command and for the wiki:
//
//   1 flag   2 env   3 config (the nearest vs-manifest.json)   4 local (the working directory)   5 installed (where the game really lives)
//
// Reads take the first candidate that exists (an explicit flag/env/config is taken as given, so a typo is reported rather than skipped).
// Writes and downloads stop at tier 4: vsdev never writes into a real game install unless told to by a flag, env var or config.
//
// The game client and the dedicated server are one location, "the game install": the server download is a strict subset of the client
// (every server file, VintagestoryServer included, is in the client, which adds textures, sounds, shaders and the game executable).
// Readers prefer a client (the installed game); `vsdev game` only ever downloads the server. The installed tier follows the game itself:
// vsapi Config/GamePaths.cs (data folder `<ApplicationData>/VintagestoryData`), the client's install.sh (`~/.local/share/vintagestory`),
// the Windows installer (`%APPDATA%\Vintagestory`) and the official server.sh (`/home/vintagestory/server`, data `/var/vintagestory/data`).
// Pure apart from the injected filesystem checks, so the order is unit tested with a fake environment.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TEXTURE_PROBE } from "vs-schematic/textureFiles.js";

export type Tier = "flag" | "env" | "config" | "local" | "installed";

export interface Candidate {
  path: string;
  tier: Tier;
  /** Where the candidate came from, e.g. "--game-dir", "$VINTAGE_STORY", "vs-manifest.json gameDir", "client install (Linux)". */
  label: string;
  /** Whether it exists / is usable (explicit tiers are used even when not, and the command reports it). */
  ok: boolean;
}

export interface Resolved {
  /** The chosen path, or undefined when nothing was found (reads only; writes always end at the local tier). */
  path?: string;
  tier?: Tier;
  label?: string;
  /** Every candidate looked at, in order. */
  candidates: Candidate[];
}

/** The parts of vs-manifest.json that locate things (the wiki's file also lists mods and items to include). */
export interface LocationConfig {
  /** The vs-manifest.json found, and its folder (relative paths in it are relative to that folder). */
  file: string;
  dir: string;
  gameDir?: string;
  gameKind?: "client" | "server";
  dataDir?: string;
  gameVersion?: string;
  serverBranch?: string;
  releasesDir?: string;
  pagesDir?: string;
}

/** What the resolver looks at; tests pass a fake one. */
export interface LocationEnv {
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  platform: NodeJS.Platform;
  /** Overrides the vs-manifest.json search (null: no config). */
  config?: LocationConfig | null;
}

export const defaultLocationEnv = (cwd: string): LocationEnv => ({ cwd, env: process.env, home: os.homedir(), platform: process.platform });

export const CONFIG_FILE = "vs-manifest.json";

/** The nearest vs-manifest.json in `cwd` or a parent folder, read for its location fields; undefined when there is none. */
export function findConfig(cwd: string): LocationConfig | undefined {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const file = path.join(dir, CONFIG_FILE);
    if (existsSync(file)) {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(readFileSync(file, "utf8"));
      } catch (err) {
        throw new Error(`${file}: ${(err as Error).message}`);
      }
      const str = (k: string) => (typeof raw[k] === "string" && raw[k] ? (raw[k] as string) : undefined);
      const kind = str("gameKind");
      return {
        file, dir,
        gameDir: str("gameDir"), gameKind: kind === "client" || kind === "server" ? kind : undefined, dataDir: str("dataDir"),
        gameVersion: str("gameVersion") ?? str("serverVersion"), serverBranch: str("serverBranch"),
        releasesDir: str("releasesDir"), pagesDir: str("pagesDir"),
      };
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

const configOf = (e: LocationEnv) => (e.config === undefined ? findConfig(e.cwd) : e.config ?? undefined);
const fromConfig = (c: LocationConfig, p: string) => path.resolve(c.dir, expandHome(p, ""));

/** `~` and `~/x` expanded (a shell would, but config files and quoted args don't). */
export function expandHome(p: string, home: string): string {
  return /^~(?=$|[\\/])/.test(p) ? path.join(home || os.homedir(), p.slice(1)) : p;
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The game's data folder rule (GamePaths: Environment.SpecialFolder.ApplicationData + "VintagestoryData"). */
export function clientDataDir(e: Pick<LocationEnv, "env" | "home" | "platform">): string {
  if (e.platform === "win32") return path.win32.join(e.env.APPDATA || path.win32.join(e.home, "AppData", "Roaming"), "VintagestoryData");
  if (e.platform === "darwin") return path.join(e.home, "Library", "Application Support", "VintagestoryData");
  return path.join(e.env.XDG_CONFIG_HOME || path.join(e.home, ".config"), "VintagestoryData");
}

/** Where a real client or server is installed by default (read-only fallbacks), client first. macOS isn't guessed. */
export function installedGameDirs(e: Pick<LocationEnv, "env" | "home" | "platform">): { path: string; label: string }[] {
  const out: { path: string; label: string }[] = [];
  if (e.platform === "win32") out.push({ path: path.win32.join(e.env.APPDATA || path.win32.join(e.home, "AppData", "Roaming"), "Vintagestory"), label: "client install (Windows installer)" });
  else if (e.platform !== "darwin") out.push({ path: path.join(e.home, ".local", "share", "vintagestory"), label: "client install (Linux install.sh)" });
  if (e.platform !== "win32") out.push({ path: "/home/vintagestory/server", label: "server install (official server.sh)" });
  return out;
}

/** Real data folders: the client's, then the dedicated server's from the official server.sh. */
export function installedDataDirs(e: Pick<LocationEnv, "env" | "home" | "platform">): { path: string; label: string }[] {
  const out = [{ path: clientDataDir(e), label: "client data folder" }];
  if (e.platform !== "win32") out.push({ path: "/var/vintagestory/data", label: "server data folder (official server.sh)" });
  return out;
}

export interface GameInfo {
  kind: "client" | "server";
  /** From assets/version-<v>.txt, when there. */
  version?: string;
}

/** `vsdev game` leaves this in a folder it installed, so it may later replace it (upgrade, other version) without --force. */
export const GAME_MARKER = ".vsdev-game.json";

export interface GameMarker {
  kind: "client" | "server";
  version: string;
  branch: string;
  url: string;
  installedAt: string;
}

/** The marker of a folder `vsdev game` installed, or undefined. */
export function readGameMarker(dir: string): GameMarker | undefined {
  try {
    const m = JSON.parse(readFileSync(path.join(dir, GAME_MARKER), "utf8")) as Partial<GameMarker>;
    return m.kind === "client" || m.kind === "server" ? (m as GameMarker) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a folder is a game install and which kind: a client has the textures (the server download has almost none). */
export function gameInfo(dir: string): GameInfo | undefined {
  const assets = path.join(dir, "assets");
  if (!isDir(assets) || !existsSync(path.join(dir, "VintagestoryAPI.dll"))) return undefined;
  const versionFile = readdirSync(assets).find((n) => /^version-.+\.txt$/.test(n));
  return { kind: existsSync(path.join(assets, TEXTURE_PROBE)) ? "client" : "server", version: versionFile?.slice("version-".length, -".txt".length) };
}

function pick(candidates: Candidate[]): Resolved {
  const chosen = candidates.find((c) => c.ok || c.tier === "flag" || c.tier === "env" || c.tier === "config");
  return { path: chosen?.path, tier: chosen?.tier, label: chosen?.label, candidates };
}

/** The local game folder (tier 4): one folder, whichever kind it holds (gameInfo tells client from server). */
export const LOCAL_GAME_DIR = "vintagestory";
/** The old name, still read (and written to, when it is the only one there) so existing checkouts keep working; rename it. */
export const LEGACY_GAME_DIR = "vs_server";

export interface GameDirOptions {
  flag?: string;
  mode: "read" | "write";
  /** Reads: skip local/installed candidates that aren't a client (for textures). */
  needClient?: boolean;
  /** Consider real installs (tier 5) for reads (default true; the wiki passes false). */
  installed?: boolean;
}

/**
 * The game install (client or server: the server download is a subset of the client, so they share one location). Locally that is
 * ./vintagestory; ./vs_server, its old name, is used when it is the only one there.
 */
export function resolveGameDir(o: GameDirOptions, e: LocationEnv = defaultLocationEnv(process.cwd())): Resolved {
  const config = configOf(e);
  const usable = (p: string) => {
    const info = gameInfo(p);
    return !!info && (!o.needClient || info.kind === "client");
  };
  const explicit: Candidate[] = [];
  if (o.flag) explicit.push({ path: path.resolve(e.cwd, expandHome(o.flag, e.home)), tier: "flag", label: "--game-dir", ok: false });
  if (e.env.VINTAGE_STORY) explicit.push({ path: path.resolve(e.cwd, expandHome(e.env.VINTAGE_STORY, e.home)), tier: "env", label: "$VINTAGE_STORY", ok: false });
  if (config?.gameDir) explicit.push({ path: fromConfig(config, config.gameDir), tier: "config", label: `${config.file} gameDir`, ok: false });
  for (const c of explicit) c.ok = o.mode === "write" || usable(c.path);

  const local = path.join(e.cwd, LOCAL_GAME_DIR);
  const legacy = path.join(e.cwd, LEGACY_GAME_DIR);
  const legacyLabel = `./${LEGACY_GAME_DIR} (old name: rename it to ./${LOCAL_GAME_DIR})`;
  if (o.mode === "write") {
    // Download into ./vintagestory, unless only an old ./vs_server is there: then into that, rather than a second copy.
    const useLegacy = !existsSync(local) && !!gameInfo(legacy);
    return pick([...explicit, useLegacy ? { path: legacy, tier: "local", label: legacyLabel, ok: true } : { path: local, tier: "local", label: `./${LOCAL_GAME_DIR}`, ok: true }]);
  }
  const locals: Candidate[] = [
    { path: local, tier: "local", label: `./${LOCAL_GAME_DIR}`, ok: usable(local) },
    { path: legacy, tier: "local", label: legacyLabel, ok: usable(legacy) },
  ];
  const installed = o.installed === false ? [] : installedGameDirs(e).map((d): Candidate => ({ path: d.path, tier: "installed", label: d.label, ok: usable(d.path) }));
  return pick([...explicit, ...locals, ...installed]);
}

export interface ModsDirOptions {
  /** -p / --data-dir: a data folder (its existing Mods/ is used) or a Mods folder itself. */
  flag?: string;
  mode: "read" | "write";
  installed?: boolean;
}

/** A -p/--data-dir value: its `Mods/` if that exists (a data folder), else the folder itself (a Mods folder), as vs-mod-updater did. */
function modsOfFlag(dir: string): string {
  const mods = path.join(dir, "Mods");
  return isDir(mods) ? mods : dir;
}

/** The Mods folder to install into (writes) or to scan (reads). */
export function resolveModsDir(o: ModsDirOptions, e: LocationEnv = defaultLocationEnv(process.cwd())): Resolved {
  const config = configOf(e);
  const candidates: Candidate[] = [];
  if (o.flag) candidates.push({ path: modsOfFlag(path.resolve(e.cwd, expandHome(o.flag, e.home))), tier: "flag", label: "--data-dir/-p", ok: true });
  if (e.env.VINTAGE_STORY_DATA) candidates.push({ path: path.join(path.resolve(e.cwd, expandHome(e.env.VINTAGE_STORY_DATA, e.home)), "Mods"), tier: "env", label: "$VINTAGE_STORY_DATA", ok: true });
  if (config?.dataDir) candidates.push({ path: path.join(fromConfig(config, config.dataDir), "Mods"), tier: "config", label: `${config.file} dataDir`, ok: true });
  const local = path.join(e.cwd, "Mods");
  candidates.push({ path: local, tier: "local", label: "./Mods", ok: o.mode === "write" || isDir(local) });
  if (o.mode === "read" && o.installed !== false) {
    for (const d of installedDataDirs(e)) {
      const mods = path.join(d.path, "Mods");
      candidates.push({ path: mods, tier: "installed", label: d.label, ok: isDir(mods) });
    }
  }
  return pick(candidates);
}

/** A project folder (Releases/ or the moddb pages): flag, then config, then ./<name>. */
export function resolveProjectDir(which: "releasesDir" | "pagesDir", flag: string | undefined, e: LocationEnv = defaultLocationEnv(process.cwd())): Resolved {
  const config = configOf(e);
  const local = which === "releasesDir" ? "Releases" : "moddb";
  const candidates: Candidate[] = [];
  if (flag) candidates.push({ path: path.resolve(e.cwd, expandHome(flag, e.home)), tier: "flag", label: which === "releasesDir" ? "--releases-dir" : "--pages-dir", ok: true });
  if (config?.[which]) candidates.push({ path: fromConfig(config, config[which]!), tier: "config", label: `${config.file} ${which}`, ok: true });
  candidates.push({ path: path.join(e.cwd, local), tier: "local", label: `./${local}`, ok: true });
  return pick(candidates);
}

/**
 * The game version without asking ModDB: flag, $VINTAGE_STORY_VERSION, config gameVersion (or the wiki's serverVersion), then the
 * version of the game install found by the read order. Undefined when none of those know; callers may then ask ModDB.
 */
export function resolveGameVersionLocal(flag: string | undefined, e: LocationEnv = defaultLocationEnv(process.cwd())): { version?: string; label?: string } {
  const bare = (v: string) => v.replace(/^v/i, "");
  if (flag) return { version: bare(flag), label: "--game-version" };
  if (e.env.VINTAGE_STORY_VERSION) return { version: bare(e.env.VINTAGE_STORY_VERSION), label: "$VINTAGE_STORY_VERSION" };
  const config = configOf(e);
  if (config?.gameVersion) return { version: bare(config.gameVersion), label: `${config.file}` };
  const game = resolveGameDir({ mode: "read" }, e);
  const info = game.path ? gameInfo(game.path) : undefined;
  if (info?.version) return { version: info.version, label: `the game install (${game.label})` };
  return {};
}
