// What the site shows for a mod: from the API (api/mod/<modid>) or, for a draft, from its public HTML page (/show/mod/<id>, the only
// place a draft is visible). A port of ModDbCli's LiveModParser, DraftPageParser and LiveLookup (ModDbClient.cs, DraftPageParser.cs);
// the draft regexes are the C# ones unchanged. `LiveClient` caches each lookup and download for one run (CachingClient).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ModDb, ModDbError } from "../mods/moddb.js";
import { PAGE_JSON, releaseJsonPath } from "./files.js";

export interface LiveRelease {
  version: string;
  fileName: string | null;
  gameVersions: string[];
  changelog: string | null;
}

export interface LiveScreenshot {
  fileName: string;
  url: string;
}

/** The parts of a mod's page that moddb/<modid>/ keeps. */
export interface LiveMod {
  modDbId: number | null;
  urlAlias: string | null;
  name: string | null;
  side: string | null;
  type: string | null;
  homepageUrl: string | null;
  sourceCodeUrl: string | null;
  trailerVideoUrl: string | null;
  issueTrackerUrl: string | null;
  wikiUrl: string | null;
  tags: string[];
  text: string | null;
  logoUrl: string | null;
  screenshots: LiveScreenshot[];
  releases: LiveRelease[];
  isDraft: boolean;
  /** /show/mod/<pageId>: the API's assetid, kept in page.json as moddbPageId for drafts. */
  pageId: number | null;
  /** The API's assetid (not stored in page.json; used to link to the page). */
  assetId: number | null;
}

const str = (o: unknown, key: string): string | null => {
  const v = (o as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : null;
};
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (x == null ? "" : String(x))) : []);

/** LiveModParser.Parse: the API answers HTTP 200 even for unknown mods, with no "mod" key; those parse to null. */
export function parseLiveMod(json: string): LiveMod | null {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch (err) {
    throw new ModDbError(`ModDB sent invalid JSON: ${(err as Error).message}`);
  }
  const mod = (root as { mod?: unknown } | null)?.mod;
  if (!mod || typeof mod !== "object" || Array.isArray(mod)) return null;
  const m = mod as Record<string, unknown>;
  const screenshots = (Array.isArray(m.screenshots) ? m.screenshots : []).map((s) => ({ fileName: str(s, "filename") ?? "", url: str(s, "mainfile") ?? "" }));
  const releases = (Array.isArray(m.releases) ? m.releases : []).map((r) => ({
    version: str(r, "modversion") ?? String((r as Record<string, unknown>)?.modversion ?? ""),
    fileName: str(r, "filename"),
    gameVersions: strings((r as Record<string, unknown>)?.tags),
    changelog: str(r, "changelog"),
  }));
  return {
    modDbId: Number.isInteger(m.modid) ? (m.modid as number) : null,
    urlAlias: str(m, "urlalias"), name: str(m, "name"), side: str(m, "side"), type: str(m, "type"),
    homepageUrl: str(m, "homepageurl"), sourceCodeUrl: str(m, "sourcecodeurl"), trailerVideoUrl: str(m, "trailervideourl"),
    issueTrackerUrl: str(m, "issuetrackerurl"), wikiUrl: str(m, "wikiurl"),
    tags: strings(m.tags), text: str(m, "text"), logoUrl: str(m, "logofile"), screenshots, releases,
    isDraft: false, pageId: null, assetId: Number.isInteger(m.assetid) ? (m.assetid as number) : null,
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", copy: "©", reg: "®", trade: "™", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·" };

/** WebUtility.HtmlDecode for what mod pages contain: numeric references and the common named ones. */
export function htmlDecode(s: string): string {
  return s.trim().replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

const RE = {
  title: /<h2>\s*<span>[^<]*<\/span>\s*\/\s*<span>(?<name>[^<]*)<\/span>\s*<\/h2>/, // the name is trimmed by htmlDecode
  tagBlock: /<dd class="tags">(?<tags>.*?)<\/dd>/s,
  tagItem: /<a [^>]*class="tag"[^>]*>(?<t>.*?)<\/a>/gs,
  side: /<dt>Side:<\/dt>\s*<dt>(?<side>[^<]*)<\/dt>/,
  linkItem: /<li><a class="external"[^>]*href="(?<url>[^"]*)">(?<label>[^<]*)<\/a><\/li>/g,
  ogImage: /<meta property="og:image" content="(?<url>[^"]*)"/,
  stage: /<div class="stage">(?<stage>.*?)<\/div>\s*<\/div>\s*(?:<button|<\/div>)/s,
  img: /<img src="(?<url>[^"]*)"/g,
  releaseRow: /<tr data-assetid="\d+"\s*>(?<row>.*?)<\/tr>(?<cl>\s*<tr><td class="collapsable cl-changelog".*?<div class="release-changelog">(?<log>.*?)<\/div><\/div><\/div>\s*<\/td><\/tr>)?/gs,
  cell: /<td>(?<v>[^<]*)<\/td>/g,
  gameTag: /<span class="tag">(?<g>[^<]*)<\/span>/g,
  fileLink: /class="button square ico-button mod-dl" href="[^"]*">(?<f>[^<]*)<\/a>/,
  cdnHash: /_[0-9a-f]{32}(?=\.[A-Za-z0-9]+$)/,
};
const DESCRIPTION_START = '<div style="clear:both;"><br></div>';
const DESCRIPTION_END = '<div style="clear:both;"></div>';

/** DraftPageParser.Parse: a mod page from its HTML. Throws when the markup isn't recognized (the site layout may have changed). */
export function parseDraftPage(html: string): LiveMod {
  const title = RE.title.exec(html);
  const descStart = html.indexOf(DESCRIPTION_START);
  const filesTab = html.indexOf('<div class="tab-content files">');
  if (!title || descStart < 0 || filesTab < 0 || descStart > filesTab) throw new ModDbError("the page markup was not recognized (the site layout may have changed)");

  const descBlock = html.slice(descStart + DESCRIPTION_START.length, filesTab);
  const descEnd = descBlock.lastIndexOf(DESCRIPTION_END);
  const text = (descEnd >= 0 ? descBlock.slice(0, descEnd) : descBlock).trim();

  const tagBlock = RE.tagBlock.exec(html);
  const tags = tagBlock ? [...tagBlock.groups!.tags.matchAll(RE.tagItem)].map((m) => htmlDecode(m.groups!.t)) : [];

  let source: string | null = null, home: string | null = null, issues: string | null = null, wiki: string | null = null, trailer: string | null = null;
  for (const m of html.slice(0, filesTab).matchAll(RE.linkItem)) {
    const url = htmlDecode(m.groups!.url);
    switch (m.groups!.label.trim().toLowerCase()) {
      case "source": case "source code": source = url; break;
      case "home": case "homepage": home = url; break;
      case "issues": case "issue tracker": case "bugs": issues = url; break;
      case "wiki": wiki = url; break;
      case "trailer": case "video": trailer = url; break;
    }
  }

  const screenshots: LiveScreenshot[] = [];
  const stage = RE.stage.exec(html);
  if (stage) {
    for (const img of stage.groups!.stage.matchAll(RE.img)) {
      const url = htmlDecode(img.groups!.url);
      const file = path.posix.basename(new URL(url).pathname);
      screenshots.push({ fileName: file.replace(RE.cdnHash, ""), url });
    }
  }

  const releases: LiveRelease[] = [];
  for (const r of html.slice(filesTab).matchAll(RE.releaseRow)) {
    const row = r.groups!.row;
    // The first cell with text in it.
    const version = [...row.matchAll(RE.cell)].map((m) => m.groups!.v.trim()).find((v) => v) ?? "";
    const games = [...row.matchAll(RE.gameTag)].map((m) => m.groups!.g.trim());
    const file = RE.fileLink.exec(row);
    releases.push({ version, fileName: file ? file.groups!.f.trim() : null, gameVersions: games, changelog: r.groups!.cl !== undefined ? r.groups!.log.trim() : null });
  }

  const side = (RE.side.exec(html)?.groups!.side ?? "").trim().toLowerCase();
  const og = RE.ogImage.exec(html);
  return {
    modDbId: null, urlAlias: null, name: htmlDecode(title.groups!.name), side: side || null, type: "mod",
    homepageUrl: home ?? "", sourceCodeUrl: source ?? "", trailerVideoUrl: trailer ?? "", issueTrackerUrl: issues ?? "", wikiUrl: wiki ?? "",
    tags, text, logoUrl: og && og.groups!.url.includes("modicon") ? htmlDecode(og.groups!.url) : null, screenshots, releases,
    isDraft: html.includes("mod-draft"), pageId: null, assetId: null,
  };
}

/** page.json's moddbPageId (set for a draft page), or null. */
export function pageIdOf(modDir: string): number | null {
  try {
    const id = (JSON.parse(readFileSync(path.join(modDir, PAGE_JSON), "utf8")) as { moddbPageId?: unknown }).moddbPageId;
    return Number.isInteger(id) ? (id as number) : null;
  } catch {
    return null;
  }
}

/**
 * LiveLookup.ExpandRanges: the HTML shows game versions as a range ("1.22.0-pre.1 - 1.22.7") where the API lists each one. A range whose
 * ends are the first and last version of the local release file is replaced by that list, so only a real change shows.
 */
export function expandRanges(live: LiveMod, modDir: string): LiveMod {
  const releases = live.releases.map((r) => {
    const file = path.join(modDir, releaseJsonPath(r.version));
    if (!existsSync(file) || r.gameVersions.length !== 1 || !r.gameVersions[0].includes(" - ")) return r;
    try {
      const local = (JSON.parse(readFileSync(file, "utf8")) as { gameVersions?: unknown }).gameVersions;
      if (!Array.isArray(local) || local.length < 2) return r;
      const [lo, hi] = r.gameVersions[0].split(" - ", 2);
      return local[0] === lo && local[local.length - 1] === hi ? { ...r, gameVersions: local.map(String) } : r;
    } catch {
      return r;
    }
  });
  return { ...live, releases };
}

/** The site, for one run: every lookup and download is made at most once (ModDbCli's CachingClient). `null` client = offline. */
export class LiveClient {
  private mods = new Map<string, Promise<LiveMod | null>>();
  private pages = new Map<number, Promise<string | null>>();
  private files = new Map<string, Promise<Buffer>>();

  constructor(private readonly db: ModDb | null = new ModDb()) {}

  private online(): ModDb {
    if (!this.db) throw new ModDbError("offline: live site not queried");
    return this.db;
  }

  mod(modid: string): Promise<LiveMod | null> {
    let p = this.mods.get(modid);
    if (!p) this.mods.set(modid, (p = this.online().rawMod(modid).then((json) => (json == null ? null : parseLiveMod(json)))));
    return p;
  }

  pageHtml(pageId: number): Promise<string | null> {
    let p = this.pages.get(pageId);
    if (!p) this.pages.set(pageId, (p = this.online().pageHtml(pageId)));
    return p;
  }

  bytes(url: string): Promise<Buffer> {
    let p = this.files.get(url);
    if (!p) this.files.set(url, (p = this.online().bytes(url)));
    return p;
  }
}

/**
 * LiveLookup.GetAsync: the mod from the API; if the API has no such mod and page.json holds a moddbPageId, the draft read from its HTML
 * page. Null if neither exists. Throws when the draft page can't be read or understood.
 */
export async function liveLookup(client: LiveClient, modid: string, modDir: string): Promise<LiveMod | null> {
  const live = await client.mod(modid);
  if (live) return live;
  const pageId = pageIdOf(modDir);
  if (pageId == null) return null;
  const html = await client.pageHtml(pageId);
  if (html == null) return null;
  try {
    return { ...expandRanges(parseDraftPage(html), modDir), pageId };
  } catch (err) {
    throw new ModDbError(`draft page ${pageId}: ${(err as Error).message}`);
  }
}
