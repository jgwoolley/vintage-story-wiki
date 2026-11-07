// The built mod zips in Releases/ (the VS mod template's CakeBuild output), which say which mods `vsdev moddb` works on: a port of
// ModDbCli's ReleaseZips.cs. modid and version come from the zip's root modinfo.json (case-insensitive, lenient JSON), else from the
// file name: this template's `<modid>_<game>_<version>.zip` or the plain `<modid>_<version>.zip`.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { UsageError } from "../errors.js";
import { modInfoFromZip, parseModInfo } from "../mods/modinfo.js";
import { compareGameVersions } from "../mods/versions.js";

export interface ReleaseZip {
  /** File name, and full path. */
  file: string;
  path: string;
  modid: string;
  version: string;
  name?: string;
  /** modinfo.json side: Universal, Client or Server. */
  side?: string;
  description?: string;
  /** The `game` dependency's version (what the zip was built against). */
  gameVersion?: string;
}

const FULL_NAME = /^(?<modid>[a-z0-9]+)_(?<game>[^_]+)_(?<version>.+)\.zip$/;
const SHORT_NAME = /^(?<modid>[a-z0-9]+)_(?<version>\d[^_]*)\.zip$/;

export function readReleaseZip(zipPath: string): ReleaseZip {
  const out: ReleaseZip = { file: path.basename(zipPath), path: zipPath, modid: "", version: "" };
  try {
    const { text } = modInfoFromZip(zipPath);
    if (text) {
      const info = parseModInfo(text);
      // Only an explicit modid counts here, as in ModDbCli; a name-derived one would hide a broken modinfo.
      out.modid = info.modidFromName ? "" : info.modid.trim().toLowerCase();
      out.version = info.version.trim();
      out.name = info.name;
      out.side = info.side;
      out.gameVersion = info.dependencies.find((d) => d.modid.toLowerCase() === "game")?.version || undefined;
      out.description = info.description;
    }
  } catch {
    // fall through to the file name
  }
  if (!out.modid || !out.version) {
    const m = FULL_NAME.exec(out.file) ?? SHORT_NAME.exec(out.file);
    if (m?.groups) {
      out.modid ||= m.groups.modid;
      out.version ||= m.groups.version;
      if (m.groups.game && m.groups.game !== "any") out.gameVersion ??= m.groups.game;
    }
  }
  return out;
}

/** The zips to look at: each argument is a zip or a folder of them (sorted by name). */
export function releaseZips(inputs: string[]): string[] {
  const out: string[] = [];
  for (const input of inputs) {
    if (statSync(input).isDirectory()) out.push(...readdirSync(input).filter((n) => n.toLowerCase().endsWith(".zip")).sort().map((n) => path.join(input, n)));
    else out.push(input);
  }
  return out;
}

/** ReleaseZips.LocalMods: the newest zip per modid (by the game's version order), sorted by modid. */
export function localMods(releasesDir: string): Map<string, ReleaseZip> {
  const mods = new Map<string, ReleaseZip>();
  for (const zip of releaseZips([releasesDir]).map(readReleaseZip)) {
    if (!zip.modid || !zip.version) continue;
    const have = mods.get(zip.modid);
    if (!have || compareGameVersions(zip.version, have.version) > 0) mods.set(zip.modid, zip);
  }
  return new Map([...mods].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/** ReleaseZips.Select: the requested modids (all when none), refusing unknown ones with the list of known ones. */
export function selectMods(known: Map<string, unknown>, requested: string[]): string[] {
  const unknown = requested.filter((m) => !known.has(m));
  if (unknown.length) throw new UsageError(`unknown modid(s): ${unknown.join(", ")}. Known (from the zips): ${[...known.keys()].join(", ") || "none"}`);
  return requested.length ? requested : [...known.keys()];
}
