// Installing and updating mods with their dependencies: a port of vs-mod-updater (resolve_install_plan, apply_install_plan,
// run_check_updates) on top of the game's own rules (ModDbUtil / ModLoader in VintagestoryLib):
// - ModDB picks the file for the game version (install-information); a dependency gets ModDB's recommended version;
// - retracted releases and mods on the blocklist are refused (the first can be overridden, as the game's "Install anyway");
// - an installed copy newer than the target is left alone (never a silent downgrade); an installed dependency that meets the
//   declared minimum is left alone;
// - after writing a new zip, older copies of the same modid are removed so the folder never holds two versions.
// Everything here returns plans and results; the CLI prints them.
import { renameSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { blockReason, formatSpec, installErrorText, parseModSpec, type InstallInfo, type ModDb } from "./moddb.js";
import { modDependencies, modInfoFromZip, parseModInfo, type ModInfo } from "./modinfo.js";
import { installedIndex, removeLocalMod, scanLocalMods, type LocalMod } from "./local.js";
import { findInSources, pickSourceRelease, sha256, type Source } from "./source.js";
import { compareGameVersions, satisfiesMinimum } from "./versions.js";

export type PlanAction =
  | "install" // not there yet: download
  | "update" // an older copy is there: download, then remove the old one
  | "current" // the target version is already there
  | "newer-installed" // the installed copy is newer than ModDB's pick: left alone
  | "satisfied" // an installed dependency already meets the required minimum: left alone
  | "error"; // couldn't be resolved; see `error`

export interface PlanEntry {
  /** Lowercased modid (or the id as asked, until the zip says otherwise). */
  modid: string;
  name: string;
  action: PlanAction;
  /** Directly asked for (false: pulled in as a dependency of `requiredBy`). */
  requested: boolean;
  requiredBy?: string;
  /** A dependency's declared minimum version. */
  minVersion?: string;
  /** The version being installed, or the installed one for current/satisfied/newer-installed. */
  version?: string;
  installedVersion?: string;
  fileName?: string;
  fileUrl?: string;
  /** Copies in the scanned Mods folder (highest version first). */
  existing: LocalMod[];
  error?: string;
  warnings: string[];
  /** The downloaded zip, kept from resolving so applying doesn't download it twice. */
  data?: Buffer;
  /** Set when the mod comes from a --source site instead of ModDB. */
  source?: string;
  /** The sha256 the download must have (source mods). */
  sha256?: string;
}

export interface Request {
  spec: string;
  requiredBy?: string;
  minVersion?: string;
}

export interface ResolveOptions {
  db: ModDb;
  gameVersion?: string;
  /** Readable mods of the target Mods folder by modid (installedIndex). */
  installed: Map<string, LocalMod[]>;
  /** Follow dependencies (default true). */
  deps?: boolean;
  /** Install retracted releases anyway (the game's "Install anyway"). */
  allowRetracted?: boolean;
  /** Reinstall even when the same or a newer version is present. */
  force?: boolean;
  /** Sites made by `vsdev moddb export` (mods.json); a mod they list is installed from them instead of ModDB. */
  sources?: Source[];
}

/** Retraction notes are HTML; keep them readable on one line. */
const plain = (html: string) => html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** The newest release tagged for `gameVersion` (any, without one) that meets `minVersion`, from the mod's listing. */
async function preReleaseFor(db: ModDb, id: string, minVersion: string, gameVersion: string | undefined): Promise<string | undefined> {
  try {
    const releases = (await db.mod(id))?.releases ?? [];
    return releases.find((r) => (!gameVersion || r.tags?.includes(gameVersion)) && satisfiesMinimum(minVersion, r.modversion))?.modversion;
  } catch {
    return undefined;
  }
}

/**
 * install-information's 4041 means both "no such mod" and "nothing for this game version / no such version". The listing tells them
 * apart, so the message can say what does exist (and how to pin it).
 */
async function notFoundText(db: ModDb, spec: { id: string; version?: string }, gameVersion: string | undefined): Promise<string> {
  let mod;
  try {
    mod = await db.mod(spec.id);
  } catch {
    return installErrorText(4041);
  }
  if (!mod) return "not found on ModDB";
  const releases = mod.releases ?? [];
  if (spec.version) {
    return `ModDB has no version ${spec.version} (newest: ${releases.slice(0, 5).map((r) => r.modversion).join(", ") || "none"})`;
  }
  const newest = releases[0];
  if (!newest) return "ModDB lists no releases for it";
  const forGame = gameVersion ? releases.filter((r) => r.tags?.includes(gameVersion)) : [];
  if (forGame.length) {
    // There are builds for this game version, but ModDB (like the game) never picks a pre-release (-dev/-pre/-rc) on its own.
    return `only pre-releases for game version ${gameVersion} (${forGame.slice(0, 3).map((r) => r.modversion).join(", ")}), which ModDB doesn't pick on its own; pin one: ${spec.id}@${forGame[0].modversion}`;
  }
  return `no release for game version ${gameVersion ?? "?"} (newest is ${newest.modversion}, for ${(newest.tags ?? []).join(", ") || "no listed game version"}); pin one with ${spec.id}@<version> or pass --game-version`;
}

function readZipInfo(data: Buffer): { info?: ModInfo; warning?: string } {
  try {
    const found = modInfoFromZip(data);
    if (found.text) return { info: parseModInfo(found.text) };
    if (found.nestedAt) return { warning: `its modinfo.json is at ${found.nestedAt}, not the zip root, so the game won't load it` };
    return { warning: "it has no modinfo.json (a code mod declaring itself in its DLL), so its dependencies can't be read" };
  } catch (err) {
    return { warning: `its modinfo.json couldn't be read (${(err as Error).message}), so its dependencies are unknown` };
  }
}

/**
 * Resolves requested mods and (unless deps is false) their dependencies, breadth-first, into a plan. Downloads each zip that would be
 * installed (dependencies live only in modinfo.json inside it). Writes nothing.
 */
export async function resolveInstallPlan(requests: Request[], opts: ResolveOptions): Promise<PlanEntry[]> {
  const { db, gameVersion, installed, deps = true, allowRetracted = false, force = false } = opts;
  const blocked = await db.blocked();
  const plan: PlanEntry[] = [];
  const seen = new Set<string>();
  const queue = [...requests];

  const follow = (entry: PlanEntry, info: ModInfo | undefined) => {
    if (!deps || !info) return;
    for (const dep of modDependencies(info)) queue.push({ spec: dep.modid, requiredBy: entry.name, minVersion: dep.version || undefined });
  };

  /** A mod listed by a --source site: its release, checked against its sha256, instead of ModDB's pick. */
  const resolveFromSource = async (entry: PlanEntry, found: NonNullable<ReturnType<typeof findInSources>>, version: string | undefined, minVersion: string | undefined) => {
    const picked = pickSourceRelease(found.mod, { version, gameVersion, minVersion });
    if (!picked.release) {
      entry.error = `${found.source.url}: ${picked.error}`;
      return;
    }
    const release = picked.release;
    if (picked.warning) entry.warnings.push(picked.warning);
    entry.source = found.source.url;
    entry.sha256 = release.sha256;
    entry.name = found.mod.name || entry.name;
    entry.fileName = release.file.split("/").pop();
    entry.fileUrl = new URL(release.file, found.source.url).toString();
    const local = entry.existing[0];
    if (!force && local?.info && (local.info.version === release.version || compareGameVersions(local.info.version, release.version) > 0)) {
      entry.action = local.info.version === release.version ? "current" : "newer-installed";
      entry.version = local.info.version;
      follow(entry, local.info);
      return;
    }
    const reason = blockReason(blocked, entry.modid, release.version);
    if (reason) {
      entry.error = `blocked by the game's blocklist: ${reason}`;
      return;
    }
    try {
      entry.data = await db.bytes(entry.fileUrl);
    } catch (err) {
      entry.error = `download failed: ${(err as Error).message}`;
      return;
    }
    if (sha256(entry.data) !== release.sha256) {
      entry.data = undefined;
      entry.error = `${entry.fileUrl}: checksum doesn't match mods.json (refusing to install it)`;
      return;
    }
    const { info: modinfo, warning } = readZipInfo(entry.data);
    if (warning) entry.warnings.push(warning);
    entry.version = release.version;
    entry.action = entry.existing.length ? "update" : "install";
    follow(entry, modinfo);
  };

  while (queue.length) {
    const request = queue.shift()!;
    let parsed: { id: string; version?: string };
    try {
      parsed = parseModSpec(request.spec);
    } catch (err) {
      plan.push({ modid: request.spec, name: request.spec, action: "error", requested: !request.requiredBy, existing: [], warnings: [], error: (err as Error).message });
      continue;
    }
    const key = parsed.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const entry: PlanEntry = {
      modid: key, name: parsed.id, action: "error", requested: !request.requiredBy, requiredBy: request.requiredBy,
      minVersion: request.minVersion, existing: installed.get(key) ?? [], warnings: [],
    };
    plan.push(entry);
    const current = entry.existing[0];
    if (current?.info) {
      entry.installedVersion = current.info.version;
      entry.name = current.info.name ?? entry.name;
    }

    // An installed dependency that meets the minimum is fine as it is (the game would load it).
    if (!entry.requested && current?.info && !force && satisfiesMinimum(request.minVersion, current.info.version)) {
      entry.action = "satisfied";
      entry.version = current.info.version;
      follow(entry, current.info);
      continue;
    }

    const settledBy = (local: LocalMod | undefined, version: string | undefined): boolean => {
      if (force || !local?.info || !version) return false;
      if (local.info.version === version) {
        entry.action = "current";
      } else if (compareGameVersions(local.info.version, version) > 0) {
        entry.action = "newer-installed";
      } else {
        return false;
      }
      entry.version = local.info.version;
      follow(entry, local.info);
      return true;
    };
    const fromSource = findInSources(opts.sources ?? [], key);
    if (fromSource) {
      await resolveFromSource(entry, fromSource, parsed.version, request.minVersion);
      continue;
    }

    const ask = async (version: string | undefined): Promise<InstallInfo | undefined> => {
      try {
        const answer = await db.installInfo([formatSpec(parsed.id, version)], gameVersion, allowRetracted);
        const found = answer.data[parsed.id] ?? answer.data[key] ?? Object.values(answer.data)[0];
        if (!found) entry.error = answer.error ?? "ModDB gave no answer for it";
        return found;
      } catch (err) {
        entry.error = (err as Error).message;
        return undefined;
      }
    };
    let info = await ask(parsed.version);
    if (info?.errorCode === 4041 && !parsed.version && request.minVersion?.includes("-")) {
      // ModDB never picks a pre-release on its own, but a dependency whose required minimum is a pre-release wants one: take the
      // newest release for this game version that meets it, then ask ModDB about that exact version (retractions still apply).
      const pick = await preReleaseFor(db, parsed.id, request.minVersion, gameVersion);
      if (pick) {
        info = await ask(pick);
        parsed = { ...parsed, version: pick };
        if (info && !info.errorCode) entry.warnings.push(`picked pre-release ${pick}, since ${request.requiredBy} needs at least ${request.minVersion}`);
      }
    }
    if (!info) continue;
    if (info.errorCode) {
      entry.error = info.errorCode === 4041 ? await notFoundText(db, parsed, gameVersion) : installErrorText(info.errorCode);
      if (info.retractionReason) entry.error += `: ${plain(info.retractionReason)}`;
      if (info.errorCode === 4101) entry.error += " (--allow-retracted installs it anyway)";
      continue;
    }
    if (info.retractionReason) {
      if (!allowRetracted) {
        entry.error = `the release was retracted: ${plain(info.retractionReason)} (--allow-retracted installs it anyway)`;
        continue;
      }
      entry.warnings.push(`installing a retracted release: ${plain(info.retractionReason)}`);
    }
    entry.fileName = info.fileName;
    entry.fileUrl = info.fileUrl;
    let target = parsed.version ?? info.recommendedUpgrade;

    if (settledBy(current, target)) continue;

    if (!info.fileUrl) {
      entry.error = "ModDB gave no file to download";
      continue;
    }
    try {
      entry.data = await db.bytes(info.fileUrl);
    } catch (err) {
      entry.error = `download failed: ${(err as Error).message}`;
      continue;
    }
    const { info: modinfo, warning } = readZipInfo(entry.data);
    if (warning) entry.warnings.push(warning);
    if (modinfo) {
      target ??= modinfo.version;
      entry.name = modinfo.name ?? entry.name;
      // Asked by alias? The zip's own modid is what the game (and the installed index) go by.
      const realKey = modinfo.modid.toLowerCase();
      if (realKey && realKey !== key) {
        seen.add(realKey);
        entry.modid = realKey;
        entry.existing = installed.get(realKey) ?? [];
        entry.installedVersion = entry.existing[0]?.info?.version;
      }
      if (settledBy(entry.existing[0], modinfo.version)) {
        entry.data = undefined;
        continue;
      }
    }
    entry.version = target;
    const reason = blockReason(blocked, entry.modid, target);
    if (reason) {
      entry.action = "error";
      entry.data = undefined;
      entry.error = `blocked by the game's blocklist: ${reason}`;
      continue;
    }
    if (request.minVersion && target && !satisfiesMinimum(request.minVersion, target)) {
      entry.warnings.push(`${request.requiredBy} needs at least ${request.minVersion}, but ModDB's pick${gameVersion ? ` for ${gameVersion}` : ""} is ${target}`);
    }
    entry.action = entry.existing.length ? "update" : "install";
    follow(entry, modinfo);
  }
  return plan;
}

export interface Applied {
  entry: PlanEntry;
  /** The zip written. */
  file?: string;
  /** Older copies removed. */
  removed: string[];
  error?: string;
}

/**
 * Writes every install/update entry into `outDir` and removes the copies it replaces. With `outDir` the scanned Mods folder (the
 * default), the old copies there go; with a different `outDir` the scanned folder is left untouched and only older copies already in
 * `outDir` go (vs-mod-updater's rule), so neither folder ends up with two versions.
 */
export async function applyInstallPlan(plan: PlanEntry[], { modsDir, outDir, db }: { modsDir: string; outDir: string; db: ModDb }): Promise<Applied[]> {
  const sameDir = path.resolve(modsDir) === path.resolve(outDir);
  await mkdir(outDir, { recursive: true });
  const outIndex = sameDir ? undefined : installedIndex(scanLocalMods(outDir));
  const results: Applied[] = [];
  for (const entry of plan) {
    if (entry.action !== "install" && entry.action !== "update") continue;
    const result: Applied = { entry, removed: [] };
    results.push(result);
    try {
      const data = entry.data ?? (await db.bytes(entry.fileUrl!));
      if (entry.sha256 && sha256(data) !== entry.sha256) throw new Error(`${entry.fileUrl}: checksum doesn't match mods.json (not installed)`);
      const dest = path.join(outDir, path.basename(entry.fileName || `${entry.modid}.zip`));
      writeFileSync(`${dest}.part`, data);
      renameSync(`${dest}.part`, dest);
      result.file = dest;
      for (const old of sameDir ? entry.existing : outIndex!.get(entry.modid) ?? []) {
        if (path.resolve(old.path) === path.resolve(dest)) continue;
        removeLocalMod(old);
        result.removed.push(old.source);
      }
    } catch (err) {
      result.error = (err as Error).message;
    }
  }
  return results;
}

export interface UpdateRow {
  modid?: string;
  name: string;
  source: string;
  installed?: string;
  /** ModDB's recommended version for the game version. */
  latest?: string;
  status: "update" | "current" | "ahead" | "unknown" | "blocked";
  detail?: string;
  /** Other copies of the same modid (the game loads only the highest). */
  duplicates: string[];
}

export interface UpdateCheck {
  rows: UpdateRow[];
  /** Updates, as plan entries ready for applyInstallPlan. */
  updates: PlanEntry[];
  /** Missing or too-old dependencies, resolved (with their own dependencies). */
  dependencyPlan: PlanEntry[];
}

/** vs-mod-updater's update check: every mod in the folder against ModDB's pick for the game version, then missing dependencies. */
export async function checkUpdates(modsDir: string, opts: Omit<ResolveOptions, "installed">): Promise<UpdateCheck> {
  const mods = scanLocalMods(modsDir);
  const index = installedIndex(mods);
  const blocked = await opts.db.blocked();
  const rows: UpdateRow[] = [];
  const updates: PlanEntry[] = [];
  for (const mod of mods.filter((m) => m.error || !m.info?.modid)) rows.push({ name: mod.source, source: mod.source, status: "unknown", detail: mod.error, duplicates: [] });

  // Mods a --source site lists are checked against it; the rest against ModDB.
  const keys = [...index.keys()].filter((k) => !findInSources(opts.sources ?? [], k));
  for (const key of [...index.keys()].filter((k) => findInSources(opts.sources ?? [], k))) {
    const [loaded, ...dupes] = index.get(key)!;
    const info = loaded.info!;
    const found = findInSources(opts.sources!, key)!;
    const row: UpdateRow = { modid: key, name: info.name ?? key, source: loaded.source, installed: info.version, status: "current", duplicates: dupes.map((d) => d.source) };
    rows.push(row);
    const picked = pickSourceRelease(found.mod, { gameVersion: opts.gameVersion });
    row.latest = picked.release?.version;
    if (!picked.release) {
      row.status = "unknown";
      row.detail = `${found.source.url}: ${picked.error}`;
    } else if (compareGameVersions(picked.release.version, info.version) > 0) {
      const reason = blockReason(blocked, key, picked.release.version);
      if (reason) {
        row.status = "blocked";
        row.detail = `${picked.release.version} is on the game's blocklist: ${reason}`;
        continue;
      }
      row.status = "update";
      row.detail = `from ${found.source.url}`;
      updates.push({
        modid: key, name: row.name, action: "update", requested: true, version: picked.release.version, installedVersion: info.version,
        fileName: picked.release.file.split("/").pop(), fileUrl: new URL(picked.release.file, found.source.url).toString(),
        existing: index.get(key)!, warnings: picked.warning ? [picked.warning] : [], source: found.source.url, sha256: picked.release.sha256,
      });
    } else if (compareGameVersions(info.version, picked.release.version) > 0) {
      row.status = "ahead";
      row.detail = `newer than ${found.source.url}`;
    }
  }
  const answers: Record<string, InstallInfo> = {};
  for (let i = 0; i < keys.length; i += 25) {
    const batch = keys.slice(i, i + 25);
    try {
      Object.assign(answers, (await opts.db.installInfo(batch, opts.gameVersion, opts.allowRetracted)).data);
    } catch (err) {
      for (const k of batch) answers[k] = { errorCode: -1, retractionReason: (err as Error).message };
    }
  }
  for (const key of keys) {
    const [loaded, ...dupes] = index.get(key)!;
    const info = loaded.info!;
    const row: UpdateRow = { modid: key, name: info.name ?? key, source: loaded.source, installed: info.version, status: "current", duplicates: dupes.map((d) => d.source) };
    rows.push(row);
    const reason = blockReason(blocked, key, info.version);
    const answer = answers[key];
    if (reason) {
      row.status = "blocked";
      row.detail = `the installed version is on the game's blocklist: ${reason}`;
    } else if (!answer || answer.errorCode) {
      row.status = "unknown";
      row.detail = answer?.errorCode === -1 ? answer.retractionReason : answer ? installErrorText(answer.errorCode!) : "no answer from ModDB";
    } else {
      row.latest = answer.recommendedUpgrade;
      if (!row.latest) {
        row.status = "unknown";
        row.detail = "ModDB recommended no version";
      } else if (compareGameVersions(row.latest, info.version) > 0) {
        if (blockReason(blocked, key, row.latest)) {
          row.status = "blocked";
          row.detail = `${row.latest} is on the game's blocklist`;
        } else if (answer.retractionReason && !opts.allowRetracted) {
          row.status = "unknown";
          row.detail = `${row.latest} is retracted: ${plain(answer.retractionReason)}`;
        } else {
          row.status = "update";
          updates.push({
            modid: key, name: row.name, action: "update", requested: true, version: row.latest, installedVersion: info.version,
            fileName: answer.fileName, fileUrl: answer.fileUrl, existing: index.get(key)!, warnings: [],
          });
        }
      } else if (compareGameVersions(info.version, row.latest) > 0) {
        row.status = "ahead";
        row.detail = `newer than ModDB's pick${opts.gameVersion ? ` for ${opts.gameVersion}` : ""}`;
      }
    }
  }

  // Dependencies nothing installed satisfies (missing, or below the declared minimum), as the game's loader would report them.
  const missing = new Map<string, Request>();
  for (const [, [loaded]] of index) {
    for (const dep of modDependencies(loaded.info!)) {
      const have = index.get(dep.modid.toLowerCase())?.[0]?.info?.version;
      if (have && satisfiesMinimum(dep.version, have)) continue;
      if (!missing.has(dep.modid.toLowerCase())) missing.set(dep.modid.toLowerCase(), { spec: dep.modid, requiredBy: loaded.info!.name ?? loaded.info!.modid, minVersion: dep.version || undefined });
    }
  }
  const dependencyPlan = missing.size ? await resolveInstallPlan([...missing.values()], { ...opts, installed: index }) : [];
  return { rows, updates, dependencyPlan };
}
