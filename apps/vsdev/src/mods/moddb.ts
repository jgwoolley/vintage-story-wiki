// mods.vintagestory.at, read the way the game reads it (ModDbUtil in VintagestoryLib):
// - which file to install is ModDB's decision, not ours: `api/v2/mods/install-information?gv=<game version>&ids=a,b@1.2.3` returns
//   each mod's file for that game version (or a pinned version), plus `recommendedUpgrade`, retraction notes and error codes;
// - `https://cdn.vintagestory.at/api/blockedmods.json` lists mods (or one `id@version`) the game refuses to install;
// - search keeps only `type: "mod"` results.
// `api/mod/<id>` (full listing) and `api/gameversions` fill in the rest. Every call takes an injected fetch so tests run offline.
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { defaultLocationEnv, resolveGameVersionLocal } from "../locations.js";
import { compareGameVersions } from "./versions.js";

export const MODDB_URL = "https://mods.vintagestory.at/";
export const BLOCKLIST_URL = "https://cdn.vintagestory.at/api/blockedmods.json";
const USER_AGENT = "vsdev (@nf3t/vsdev)";

export type Fetch = typeof fetch;

export interface ModDbRelease {
  modidstr?: string;
  modversion: string;
  filename: string;
  /** Absolute CDN URL of the file. */
  mainfile: string;
  /** Game versions this release is tagged for, e.g. "1.22.7". */
  tags?: string[];
  created?: string;
  downloads?: number;
}

export interface ModDbMod {
  modid: number;
  assetid: number;
  name: string;
  author?: string;
  urlalias?: string | null;
  side?: string;
  type?: string;
  tags?: string[];
  logofile?: string | null;
  homepageurl?: string | null;
  sourcecodeurl?: string | null;
  issuetrackerurl?: string | null;
  wikiurl?: string | null;
  downloads?: number;
  follows?: number;
  created?: string;
  lastreleased?: string;
  releases: ModDbRelease[];
}

export interface ModSearchHit {
  modid: number;
  assetid: number;
  name: string;
  summary?: string;
  modidstrs: string[];
  author?: string;
  urlalias?: string | null;
  side?: string;
  type?: string;
  tags?: string[];
  downloads?: number;
  follows?: number;
  lastreleased?: string;
}

/** One mod's answer from install-information. */
export interface InstallInfo {
  /** Non-zero on failure; see installErrorText. */
  errorCode?: number;
  fileName?: string;
  /** Relative to MODDB_URL. */
  fileUrl?: string;
  /** Set when the chosen release is retracted (HTML). */
  retractionReason?: string;
  /** The version ModDB recommends for this game version (the newest compatible one). */
  recommendedUpgrade?: string;
}

/** ModInstallInformation.EnumErrorCode, with the game's own wording. */
export const INSTALL_ERRORS: Record<number, string> = {
  4001: "malformed mod spec",
  4002: "no version given and no game version to pick one for",
  4031: "not allowed in hosted mode",
  4032: "this release's retraction can't be ignored",
  4041: "not found on ModDB (or no such version)",
  4101: "the release was retracted",
  4102: "the release was retracted and can't be installed",
};

export const installErrorText = (code: number) => INSTALL_ERRORS[code] ?? `unknown ModDB error ${code}`;

/** "id", "id@1.2.3" (the game's form) or "id:1.2.3" (vs-manifest.json's older form). */
export function parseModSpec(spec: string): { id: string; version?: string } {
  const m = /^([^@:]+)(?:[@:](.+))?$/.exec(spec.trim());
  if (!m) throw new Error(`can't read mod spec '${spec}' (expected modid or modid@version)`);
  return { id: m[1].trim(), version: m[2]?.trim() || undefined };
}

export const formatSpec = (id: string, version?: string) => (version ? `${id}@${version}` : id);

/** A game version name without the "v" the game itself prefixes ("v1.22.7" -> "1.22.7"). */
export const bareVersion = (name: string) => name.replace(/^v/i, "");

/** The newest stable (no -rc/-pre/-dev) game version in /api/gameversions. */
export function latestStableGameVersion(names: string[]): string | undefined {
  return names.map(bareVersion).filter((n) => /^\d+\.\d+\.\d+$/.test(n)).sort(compareGameVersions).pop();
}

/** The block reason for a mod or one version of it (BlockedMods: an entry is "id" or "id@version"), else undefined. */
export function blockReason(blocked: ReadonlyMap<string, string> | null, id: string, version?: string): string | undefined {
  if (!blocked) return undefined;
  return (version ? blocked.get(`${id}@${version}`) : undefined) ?? blocked.get(id);
}

export class ModDbError extends Error {}

/** Orders search hits: exact modid/alias, then name matches, then summary matches, then the rest; more downloads first within each. */
export function rankSearch<T extends Pick<ModSearchHit, "name" | "summary" | "modidstrs" | "urlalias" | "downloads">>(hits: T[], text: string): T[] {
  const q = text.trim().toLowerCase();
  const rank = (h: T) =>
    [...(h.modidstrs ?? []), h.urlalias ?? ""].some((id) => id.toLowerCase() === q) ? 0
    : h.name.toLowerCase().includes(q) ? 1
    : (h.summary ?? "").toLowerCase().includes(q) || (h.modidstrs ?? []).some((id) => id.toLowerCase().includes(q)) ? 2
    : 3;
  return hits.map((h) => ({ h, r: rank(h) })).sort((a, b) => a.r - b.r || (b.h.downloads ?? 0) - (a.h.downloads ?? 0)).map((x) => x.h);
}

export class ModDb {
  private blocklist?: Promise<ReadonlyMap<string, string> | null>;

  constructor(private readonly fetchImpl: Fetch = fetch, readonly baseUrl = MODDB_URL) {}

  private async get(url: string, attempts = 3): Promise<Response> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      if (i) await new Promise((r) => setTimeout(r, i * 500));
      try {
        const res = await this.fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
        if (res.status >= 500) throw new ModDbError(`${url}: HTTP ${res.status}`);
        return res;
      } catch (err) {
        last = err;
      }
    }
    throw new ModDbError(`couldn't reach ${new URL(url).host}: ${(last as Error).message}`);
  }

  private async json<T>(action: string): Promise<T> {
    const res = await this.get(new URL(action, this.baseUrl).toString());
    if (!res.ok) throw new ModDbError(`ModDB ${action}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** The raw api/mod/<id> response text, or null on HTTP 404 (an unknown mod is HTTP 200 with "statuscode":"404"; the parser sees that). */
  async rawMod(idOrAlias: string): Promise<string | null> {
    const res = await this.get(new URL(`api/mod/${encodeURIComponent(idOrAlias)}`, this.baseUrl).toString());
    if (res.status === 404) return null;
    if (!res.ok) throw new ModDbError(`ModDB api/mod/${idOrAlias}: HTTP ${res.status}`);
    return res.text();
  }

  /** The public HTML of /show/mod/<assetId> (the only place a draft page is visible), or null if there is no such page. */
  async pageHtml(assetId: number): Promise<string | null> {
    const res = await this.get(new URL(`show/mod/${assetId}`, this.baseUrl).toString());
    if (res.status === 404) return null;
    if (!res.ok) throw new ModDbError(`ModDB show/mod/${assetId}: HTTP ${res.status}`);
    return res.text();
  }

  /** The full listing (with every release, newest first), or null when ModDB has no such mod. */
  async mod(idOrAlias: string): Promise<ModDbMod | null> {
    const data = await this.json<{ statuscode?: string | number; mod?: ModDbMod }>(`api/mod/${encodeURIComponent(idOrAlias)}`);
    if (String(data.statuscode) === "404" || !data.mod) return null;
    if (String(data.statuscode) !== "200") throw new ModDbError(`ModDB lookup of ${idOrAlias}: status ${data.statuscode}`);
    return data.mod;
  }

  /**
   * Text search, mods only (as the game filters), optionally limited to mods with a release for one of the game version tag ids.
   * ModDB's text match also hits descriptions and has no relevance order, so this fetches the 100 most-downloaded matches and ranks them
   * (rankSearch) before cutting to `limit`. The game's own `gv[]` parameter makes the current API fail; `gameversions[]` works.
   */
  async search(text: string, { limit = 20, gameVersionIds = [] as number[] } = {}): Promise<ModSearchHit[]> {
    const gv = gameVersionIds.map((id) => `&gameversions[]=${id}`).join("");
    const data = await this.json<{ statuscode?: string; mods?: ModSearchHit[] }>(`api/mods?text=${encodeURIComponent(text).replace(/%20/g, "+")}${gv}&orderby=downloads&limit=${Math.max(100, limit)}`);
    if (String(data.statuscode) !== "200") throw new ModDbError(`ModDB search: status ${data.statuscode}`);
    return rankSearch((data.mods ?? []).filter((m) => (m.type ?? "mod") === "mod"), text).slice(0, limit);
  }

  /** Every game version ModDB knows: `{ tagid, name }`, names with or without a leading "v". */
  async gameVersions(): Promise<{ tagid: number; name: string }[]> {
    const data = await this.json<{ gameversions?: { tagid: number; name: string }[] }>("api/gameversions");
    return data.gameversions ?? [];
  }

  /**
   * ModDB's pick of file per spec for a game version (the game's FetchModInstallInformation). Keys of the result are the ids as given
   * (without "@version"). `error` is ModDB's message for the whole request, e.g. when every spec is malformed.
   */
  async installInfo(specs: string[], gameVersion: string | undefined, ignoreRetractions = false): Promise<{ data: Record<string, InstallInfo>; error?: string }> {
    const params = [gameVersion ? `gv=${encodeURIComponent(gameVersion)}` : "", ignoreRetractions ? "ignore-retractions=1" : "", `ids=${specs.map(encodeURIComponent).join(",")}`];
    const res = await this.get(new URL(`api/v2/mods/install-information?${params.filter(Boolean).join("&")}`, this.baseUrl).toString());
    const body = (await res.json().catch(() => ({}))) as { data?: Record<string, InstallInfo>; error?: string };
    if (!body.data && !res.ok) throw new ModDbError(`ModDB install-information: HTTP ${res.status}${body.error ? ` (${body.error})` : ""}`);
    return { data: body.data ?? {}, error: body.error };
  }

  /** The game's blocked-mods list ("id" or "id@version" -> reason), fetched once; null if it couldn't be fetched (the game then goes on). */
  blocked(): Promise<ReadonlyMap<string, string> | null> {
    this.blocklist ??= (async () => {
      try {
        const res = await this.get(BLOCKLIST_URL);
        if (!res.ok) return null;
        const list = (await res.json()) as { id: string; reason: string }[];
        return new Map(list.map((b) => [b.id, b.reason]));
      } catch {
        return null;
      }
    })();
    return this.blocklist;
  }

  /** Downloads a file (an install-information fileUrl, or an absolute URL) into memory. */
  async bytes(fileUrl: string): Promise<Buffer> {
    const res = await this.get(new URL(fileUrl, this.baseUrl).toString());
    if (!res.ok) throw new ModDbError(`download ${fileUrl}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Streams a file to `dest` through a `.part` file, so a failed download never leaves a broken zip under the real name. */
  async download(fileUrl: string, dest: string): Promise<void> {
    const res = await this.get(new URL(fileUrl, this.baseUrl).toString());
    if (!res.ok || !res.body) throw new ModDbError(`download ${fileUrl}: HTTP ${res.status}`);
    await mkdir(path.dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
      await rename(part, dest);
    } catch (err) {
      await rm(part, { force: true });
      throw err;
    }
  }
}

/**
 * The game version to ask ModDB about, by the location rule (src/locations.ts): --game-version, $VINTAGE_STORY_VERSION, vs-manifest.json,
 * the version of the game install found (assets/version-*.txt), else the newest stable version ModDB lists. Returns where it came from.
 */
export async function resolveGameVersion(db: ModDb, given?: string, cwd = process.cwd()): Promise<{ version: string; source: string }> {
  const local = resolveGameVersionLocal(given, defaultLocationEnv(cwd));
  if (local.version) return { version: local.version, source: local.label! };
  const latest = latestStableGameVersion((await db.gameVersions()).map((g) => g.name));
  if (!latest) throw new ModDbError("ModDB listed no game versions; pass --game-version");
  return { version: latest, source: "newest stable on ModDB" };
}
