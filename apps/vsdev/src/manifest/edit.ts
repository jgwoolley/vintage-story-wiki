// vs-manifest.json as a requirements file (like pip's): `vsdev manifest freeze` writes the mods in a folder into its `mods` list, and
// `vsdev manifest install` (and `vsdev download`) puts the listed mods into a folder. This is the pure half of freeze: what a folder
// pins, and how that changes the list. Only `mods` is touched; every other key of the file is kept as it is.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readReleaseZip, releaseZips } from "../moddb/releases.js";
import { installedIndex, scanLocalMods } from "../mods/local.js";
import { compareGameVersions } from "../mods/versions.js";

export interface Pin {
  modid: string;
  version: string;
}

export interface ManifestMod {
  modid: string;
  version?: string;
  /** The mod's own source folder (with modinfo.json), relative to the manifest. */
  src?: string;
  /** Direct download link of the pinned release, for a draft mod the ModDB API doesn't list. */
  url?: string;
}

export interface Skipped {
  name: string;
  reason: string;
}

/** The newest version of each mod in a game Mods folder (the copy the game would load), and what couldn't be read. */
export function pinsFromModsFolder(dir: string): { pins: Pin[]; skipped: Skipped[] } {
  const mods = scanLocalMods(dir);
  const pins: Pin[] = [];
  for (const [modid, list] of installedIndex(mods)) pins.push({ modid, version: list[0].info!.version });
  const skipped = mods.filter((m) => !m.info?.modid || m.error).map((m) => ({ name: m.source, reason: m.error ?? "no mod info" }));
  return { pins: pins.sort((a, b) => a.modid.localeCompare(b.modid)), skipped };
}

/** The newest zip of each mod in a Releases folder (a mod project's build output). */
export function pinsFromReleases(dir: string): { pins: Pin[]; skipped: Skipped[] } {
  const newest = new Map<string, Pin>();
  const skipped: Skipped[] = [];
  for (const zip of releaseZips([dir])) {
    const r = readReleaseZip(zip);
    if (!r.modid || !r.version) {
      skipped.push({ name: r.file, reason: "no modid/version in its modinfo.json or file name" });
      continue;
    }
    const have = newest.get(r.modid);
    if (!have || compareGameVersions(r.version, have.version) > 0) newest.set(r.modid, { modid: r.modid, version: r.version });
  }
  return { pins: [...newest.values()].sort((a, b) => a.modid.localeCompare(b.modid)), skipped };
}

export interface Change {
  action: "add" | "update" | "remove" | "same";
  modid: string;
  from?: string;
  to?: string;
}

/**
 * The new `mods` list: entries keep their place and spelling; a pinned version replaces the listed one (also filling in an unpinned entry);
 * mods the folder has and the list doesn't are appended in modid order; with `prune`, listed mods the folder doesn't have are dropped.
 */
export function mergePins(existing: ManifestMod[], pins: Pin[], prune = false): { mods: ManifestMod[]; changes: Change[] } {
  const byId = new Map(pins.map((p) => [p.modid.toLowerCase(), p]));
  const seen = new Set<string>();
  const mods: ManifestMod[] = [];
  const changes: Change[] = [];
  for (const entry of existing) {
    const key = entry.modid.toLowerCase();
    const pin = byId.get(key);
    seen.add(key);
    if (!pin) {
      if (prune) changes.push({ action: "remove", modid: entry.modid, from: entry.version });
      else mods.push(entry);
      continue;
    }
    // A direct `url` belongs to the old version's file: a new pin drops it (back to the API, or add the new link by hand).
    const { url, ...rest } = entry;
    mods.push(url && entry.version !== pin.version ? { ...rest, version: pin.version } : { ...entry, version: pin.version });
    changes.push(entry.version === pin.version ? { action: "same", modid: entry.modid, to: pin.version } : { action: "update", modid: entry.modid, from: entry.version, to: pin.version });
  }
  for (const pin of pins) {
    if (seen.has(pin.modid.toLowerCase())) continue;
    mods.push({ modid: pin.modid.toLowerCase(), version: pin.version });
    changes.push({ action: "add", modid: pin.modid.toLowerCase(), to: pin.version });
  }
  return { mods, changes };
}

/** The file's `mods` list (empty when the file is missing or has none). */
export function readManifestMods(file: string): ManifestMod[] {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { mods?: ManifestMod[] };
    return (raw.mods ?? []).filter((m) => m && typeof m.modid === "string");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`${file}: ${(err as Error).message}`);
  }
}

/** Writes `mods` into the file, keeping its other keys (two-space JSON; a missing file is created). */
export function writeManifestMods(file: string, mods: ManifestMod[]): void {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`${file}: ${(err as Error).message}`);
  }
  writeFileSync(file, `${JSON.stringify({ ...raw, mods }, null, 2)}\n`);
}

export const defaultManifestFile = (cwd: string) => path.join(cwd, "vs-manifest.json");

/** modid (lower case) -> absolute source folder, for the manifest's mods that give a `src` (relative to the manifest file). */
export function modSourceDirs(file: string): Map<string, string> {
  const dir = path.dirname(path.resolve(file));
  const map = new Map<string, string>();
  for (const m of readManifestMods(file)) if (typeof m.src === "string" && m.src) map.set(m.modid.toLowerCase(), path.resolve(dir, m.src));
  return map;
}
