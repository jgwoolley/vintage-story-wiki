// A Mods folder as the game sees it (ModLoader.CollectMods / ModContainer): every folder and every .zip, .dll and .cs file is a mod;
// the game reads modinfo.json from the root of a zip or folder; when several copies share a modid it loads only the highest version.
// Ported in spirit from vs-mod-updater's scan_local_mods, with the game's rules where the two differ (root-only modinfo, code mods).
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { modInfoFromDir, modInfoFromZip, parseModInfo, type ModInfo } from "./modinfo.js";
import { compareGameVersions } from "./versions.js";

export interface LocalMod {
  /** File or folder name inside the Mods folder. */
  source: string;
  /** Full path. */
  path: string;
  kind: "zip" | "folder" | "dll" | "cs";
  /** Parsed modinfo.json, when it could be read. */
  info?: ModInfo;
  /** Why this entry can't be checked (no modinfo.json, a code-only mod, unreadable zip...). */
  error?: string;
}

const KINDS: Record<string, LocalMod["kind"]> = { ".zip": "zip", ".dll": "dll", ".cs": "cs" };

/** Reads one entry of a Mods folder, or undefined when the game wouldn't treat it as a mod at all. */
export function readLocalMod(dir: string, source: string): LocalMod | undefined {
  const full = path.join(dir, source);
  let isDir: boolean;
  try {
    isDir = statSync(full).isDirectory();
  } catch {
    return undefined;
  }
  const kind = isDir ? "folder" : KINDS[path.extname(source).toLowerCase()];
  if (!kind) return undefined;
  const mod: LocalMod = { source, path: full, kind };
  if (kind === "dll" || kind === "cs") {
    mod.error = "code-only mod file; its mod info is inside the code, which vsdev doesn't read";
    return mod;
  }
  try {
    let text: string | undefined;
    if (kind === "zip") {
      const found = modInfoFromZip(full);
      text = found.text;
      if (!text) {
        mod.error = found.nestedAt
          ? `modinfo.json is at ${found.nestedAt}, not the zip's root: the game won't load this mod`
          : found.hasDll
            ? "no modinfo.json (a code mod declaring itself in its DLL; not checked)"
            : "no modinfo.json";
        return mod;
      }
    } else {
      text = modInfoFromDir(full);
      if (!text) {
        mod.error = "no modinfo.json in the folder";
        return mod;
      }
    }
    mod.info = parseModInfo(text);
    if (!mod.info.modid) mod.error = "modinfo.json has no modid (and no name to make one from)";
    else if (!mod.info.version) mod.error = "modinfo.json has no version";
  } catch (err) {
    mod.error = `could not read: ${(err as Error).message}`;
  }
  return mod;
}

/** Every mod in a Mods folder, in the game's order (file name, case-insensitive). */
export function scanLocalMods(dir: string): LocalMod[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.endsWith(".part"))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((n) => readLocalMod(dir, n))
    .filter((m): m is LocalMod => !!m);
}

/** Readable mods by lowercased modid, each list highest version first (the copy the game would load). */
export function installedIndex(mods: LocalMod[]): Map<string, LocalMod[]> {
  const index = new Map<string, LocalMod[]>();
  for (const mod of mods) {
    if (!mod.info?.modid || mod.error) continue;
    const key = mod.info.modid.toLowerCase();
    (index.get(key) ?? index.set(key, []).get(key)!).push(mod);
  }
  for (const list of index.values()) list.sort((a, b) => compareGameVersions(b.info!.version, a.info!.version));
  return index;
}

export function removeLocalMod(mod: LocalMod): void {
  rmSync(mod.path, { recursive: true, force: true });
}
