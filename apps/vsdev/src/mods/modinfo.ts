// Reading a mod's modinfo.json the way the game does (vsapi Common/API/ModInfo.cs, ModContainer in VintagestoryLib):
// - only `modinfo.json` at the root of the zip or folder counts (a copy in a subfolder means the game won't load the mod);
// - it is parsed by Newtonsoft, which tolerates comments, trailing commas, single quotes and unquoted keys (json5 reads all of those)
//   and matches property names case-insensitively;
// - a missing modid is made from the name (ModInfo.ToModID: letters and digits, lowercased);
// - dependencies are `{ "modid": "minimum version" }`, where "" means any version.
import AdmZip from "adm-zip";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import JSON5 from "json5";

/** The mod ids that are the game itself; a dependency on them is a game-version requirement, not a mod to download. */
export const GAME_MOD_IDS = new Set(["game", "survival", "creative"]);

export interface ModDependency {
  modid: string;
  /** Minimum version; "" for any. */
  version: string;
}

export interface ModInfo {
  modid: string;
  version: string;
  name?: string;
  side?: string;
  type?: string;
  description?: string;
  /** Every declared dependency, including the game ones. */
  dependencies: ModDependency[];
  /** Set when the modid wasn't in the file and was made from the name, as the game does. */
  modidFromName?: boolean;
  /** Problems the game would trip over (an invalid dependency id...). */
  problems: string[];
}

/** A property by name, ignoring case like Newtonsoft does. */
export function getCi(obj: Record<string, unknown>, ...keys: string[]): unknown {
  const wanted = keys.map((k) => k.toLowerCase());
  for (const [k, v] of Object.entries(obj)) if (wanted.includes(k.toLowerCase())) return v;
  return undefined;
}

/** ModInfo.ToModID: keeps ASCII letters and digits, lowercased; undefined if it would start with a digit (the game throws). */
export function toModId(name: string): string | undefined {
  if (/^[0-9]/.test(name)) return undefined;
  return name.replace(/[^A-Za-z0-9]/g, "").toLowerCase() || undefined;
}

/** ModInfo.IsValidModID: a lowercase letter, then lowercase letters and digits. */
export function isValidModId(id: string): boolean {
  return /^[a-z][a-z0-9]*$/.test(id);
}

/** Parses modinfo.json text (BOM and JSON5 tolerated) into what vsdev needs. Throws on text that isn't an object. */
export function parseModInfo(text: string): ModInfo {
  const raw: unknown = JSON5.parse(text.replace(/^﻿/, ""));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("modinfo.json is not an object");
  const obj = raw as Record<string, unknown>;
  const str = (...keys: string[]) => {
    const v = getCi(obj, ...keys);
    return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
  };
  const name = str("name");
  let modid = str("modid")?.trim();
  let modidFromName = false;
  if (!modid && name) {
    modid = toModId(name);
    modidFromName = !!modid;
  }
  const problems: string[] = [];
  const dependencies: ModDependency[] = [];
  const deps = getCi(obj, "dependencies");
  if (deps && typeof deps === "object" && !Array.isArray(deps)) {
    for (const [id, version] of Object.entries(deps as Record<string, unknown>)) {
      if (!isValidModId(id)) problems.push(`dependency '${id}' is not a valid mod id (the game refuses to load the mod)`);
      dependencies.push({ modid: id, version: typeof version === "string" ? version : version == null ? "" : String(version) });
    }
  }
  if (!modid) problems.push("no modid and no usable name");
  return { modid: modid ?? "", version: str("version")?.trim() ?? "", name, side: str("side"), type: str("type"), description: str("description"), dependencies, modidFromName, problems };
}

/** The dependencies vsdev should fetch: everything except the game itself. */
export function modDependencies(info: Pick<ModInfo, "dependencies">): ModDependency[] {
  return info.dependencies.filter((d) => !GAME_MOD_IDS.has(d.modid.toLowerCase()));
}

export interface ZipModInfo {
  /** Root modinfo.json text, if there is one. */
  text?: string;
  /** Where a modinfo.json was found instead, when it isn't at the root. */
  nestedAt?: string;
  /** Whether the zip has .dll files (a code mod, whose info may live in the DLL instead). */
  hasDll: boolean;
}

/** The root modinfo.json of a mod zip (a path or the bytes), matched case-insensitively. */
export function modInfoFromZip(zip: string | Buffer): ZipModInfo {
  const entries = new AdmZip(zip).getEntries().filter((e) => !e.isDirectory);
  const named = entries.filter((e) => path.posix.basename(e.entryName).toLowerCase() === "modinfo.json");
  const root = named.find((e) => !e.entryName.includes("/"));
  const hasDll = entries.some((e) => e.entryName.toLowerCase().endsWith(".dll"));
  if (root) return { text: root.getData().toString("utf8"), hasDll };
  return { nestedAt: named.sort((a, b) => a.entryName.split("/").length - b.entryName.split("/").length)[0]?.entryName, hasDll };
}

/** The root modinfo.json text of an unpacked mod folder, matched case-insensitively. */
export function modInfoFromDir(dir: string): string | undefined {
  const name = readdirSync(dir).find((n) => n.toLowerCase() === "modinfo.json");
  return name ? readFileSync(path.join(dir, name), "utf8") : undefined;
}
