// Mod sources other than ModDB: a site made by `vsdev moddb export` publishes `mods.json`, an index of the mods it hosts (often versions
// not on ModDB yet). `vsdev mod install/update --source <site url>` installs those mods from it: the release is picked like ModDB would
// (pinned version, else the newest for the game version), its sha256 is checked, and its dependencies still come from ModDB unless a
// source lists them too.
import { createHash } from "node:crypto";
import { compareGameVersions } from "./versions.js";
import { satisfiesMinimum } from "./versions.js";
import type { Fetch } from "./moddb.js";

/** mods.json, format 1 (written by src/moddb/export.ts). */
export interface SourceIndexFile {
  format: 1;
  generator?: string;
  mods: SourceMod[];
}

export interface SourceMod {
  modid: string;
  name: string;
  side?: string;
  /** The mod's page on the site, relative to the index. */
  page: string;
  releases: SourceRelease[];
}

export interface SourceRelease {
  version: string;
  gameVersions: string[];
  /** The zip, relative to the index. */
  file: string;
  sha256: string;
  size: number;
  /** modid -> minimum version, from the zip's modinfo.json (game ones included). */
  dependencies: Record<string, string>;
  /** Whether this version is also on ModDB (when the site was exported online). */
  onModDb?: boolean;
}

export interface Source {
  /** The site's base URL, ending in "/". */
  url: string;
  mods: SourceMod[];
}

/** Fetches `<url>/mods.json` (a URL to mods.json itself also works). */
export async function loadSource(url: string, fetchImpl: Fetch = fetch): Promise<Source> {
  const index = new URL(url.endsWith("mods.json") ? url : url.replace(/\/?$/, "/") + "mods.json");
  const res = await fetchImpl(index, { headers: { "User-Agent": "vsdev (@nf3t/vsdev)" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${index}: HTTP ${res.status}`);
  const data = (await res.json()) as Partial<SourceIndexFile>;
  if (data.format !== 1 || !Array.isArray(data.mods)) throw new Error(`${index}: not a vsdev mods.json (format 1)`);
  return { url: new URL(".", index).toString(), mods: data.mods };
}

/** The source that lists `modid` (first one wins), and its entry. */
export function findInSources(sources: Source[], modid: string): { source: Source; mod: SourceMod } | undefined {
  for (const source of sources) {
    const mod = source.mods.find((m) => m.modid.toLowerCase() === modid.toLowerCase());
    if (mod) return { source, mod };
  }
  return undefined;
}

/**
 * The release to install: the pinned version; else the newest release tagged for the game version, else one for the same major.minor
 * (with a warning), else the newest one (with a warning); a dependency's minimum must be met.
 */
export function pickSourceRelease(mod: SourceMod, o: { version?: string; gameVersion?: string; minVersion?: string }): { release?: SourceRelease; warning?: string; error?: string } {
  const releases = [...mod.releases].sort((a, b) => compareGameVersions(b.version, a.version)).filter((r) => satisfiesMinimum(o.minVersion, r.version));
  if (o.version) {
    const exact = mod.releases.find((r) => r.version === o.version);
    return exact ? { release: exact } : { error: `the source has no version ${o.version} (it has ${mod.releases.map((r) => r.version).join(", ") || "none"})` };
  }
  if (!releases.length) return { error: `the source has no release${o.minVersion ? ` of at least ${o.minVersion}` : ""}` };
  if (!o.gameVersion) return { release: releases[0] };
  const exact = releases.find((r) => r.gameVersions.includes(o.gameVersion!));
  if (exact) return { release: exact };
  const minor = o.gameVersion.split(".").slice(0, 2).join(".");
  const close = releases.find((r) => r.gameVersions.some((g) => g.split(".").slice(0, 2).join(".") === minor));
  if (close) return { release: close, warning: `no release for game version ${o.gameVersion}; using ${close.version} (made for ${close.gameVersions.join(", ")})` };
  return { release: releases[0], warning: `no release for game version ${o.gameVersion}; using the newest, ${releases[0].version} (made for ${releases[0].gameVersions.join(", ") || "an unlisted game version"})` };
}

export const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
