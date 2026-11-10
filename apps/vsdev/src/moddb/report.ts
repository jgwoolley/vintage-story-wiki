// The per-mod report the review page (`vsdev moddb serve`) shows, built from the zips, moddb/<modid>/ and the live site: a port of
// ModDbCli's ModReport.cs. Field names are the camelCase ones web/app.js reads.
// Differences from ModDbCli, by request: images named in page.json must be in moddb/<modid>/images/ whether or not the page is published
// (that folder is where screenshots live, not the C# project's Screenshots/ folder, which isn't checked); the C# project is found by its
// modinfo.json next to the pages folder (the VS mod template layout) for the modicon.png check; commands shown are `vsdev moddb ...`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { modInfoFromDir, parseModInfo } from "../mods/modinfo.js";
import { compareTriple, htmlLint, imageChecks, IMAGE_LIMITS, parseTriple, versionWarnings } from "./checks.js";
import { comparePage, type PageDiff } from "./compare.js";
import { buildFiles, DESCRIPTION, IMAGES_DIR, PAGE_JSON, readLocal, releaseHtmlPath, releaseJsonPath, tidyHtml } from "./files.js";
import { liveLookup, LiveClient, pageIdOf, type LiveMod } from "./live.js";
import { localMods, type ReleaseZip } from "./releases.js";
import { PageValidator } from "./validate.js";

export const SITE = "https://mods.vintagestory.at";

export interface ModTask { id: string; title: string; detail: string; url?: string | null }
export interface ReleaseInfo { version: string; uploaded: boolean; inZip: boolean; zip: string | null; gameVersions: string[]; localChangelog: string; liveChangelog: string | null }
export interface ImageInfo { kind: "logo" | "screenshot"; name: string; localUrl: string | null; liveUrl: string | null }
export interface FilePair { name: string; local: string | null; live: string | null }
export interface Fields { name: string | null; side: string | null; type: string | null; homepage: string | null; sourceCode: string | null; trailer: string | null; issueTracker: string | null; wiki: string | null; tags: string[] }

export type ReportState = "offline" | "error" | "unpublished" | "draft" | "draft-new-version" | "new-version" | "uploaded";

export interface ModReport {
  modId: string;
  state: ReportState;
  error: string | null;
  modDbId: number | null;
  pageUrl: string | null;
  localVersion: string;
  zip: string | null;
  local: Fields;
  live: Fields | null;
  localDescription: string;
  liveDescription: string | null;
  diff: string;
  diffStatus: string;
  files: FilePair[];
  releases: ReleaseInfo[];
  images: ImageInfo[];
  warnings: string[];
  tasks: ModTask[];
  pullCommand: string;
}

const parse = (json: string | undefined): Record<string, unknown> | null => {
  if (json === undefined) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
};
const s = (o: Record<string, unknown> | null, k: string) => (typeof o?.[k] === "string" ? (o[k] as string) : null);
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "")) : []);

export class ReportBuilder {
  private client: LiveClient;
  /** The folder the pages folder sits in, where the mod projects are (VS mod template: <root>/<Project>/modinfo.json). */
  private readonly root: string;

  constructor(readonly releasesDir: string, readonly pagesDir: string, private readonly clientFactory: () => LiveClient) {
    this.client = clientFactory();
    this.root = path.dirname(path.resolve(pagesDir));
  }

  /** Forget everything fetched from the site. */
  refresh(): void {
    this.client = this.clientFactory();
  }

  async build(modid: string): Promise<ModReport> {
    const zip = localMods(this.releasesDir).get(modid);
    const modDir = path.join(this.pagesDir, modid);
    const local = readLocal(modDir);
    const page = parse(local[PAGE_JSON]);
    const r: ModReport = {
      modId: modid, state: "unpublished", error: null, modDbId: null, pageUrl: null, localVersion: zip?.version ?? "", zip: zip?.file ?? null,
      local: {
        name: s(page, "name"), side: s(page, "side"), type: s(page, "type"), homepage: s(page, "homepageurl"), sourceCode: s(page, "sourcecodeurl"),
        trailer: s(page, "trailervideourl"), issueTracker: s(page, "issuetrackerurl"), wiki: s(page, "wikiurl"), tags: list(page?.tags),
      },
      live: null, localDescription: local[DESCRIPTION] ?? "", liveDescription: null, diff: "", diffStatus: "", files: [], releases: [], images: [],
      warnings: [], tasks: [], pullCommand: `vsdev moddb pull ${modid}`,
    };

    let live: LiveMod | null = null;
    try {
      live = await liveLookup(this.client, modid, modDir);
    } catch (err) {
      r.error = (err as Error).message;
    }
    let diff: PageDiff | null = null;
    if (r.error == null) {
      try {
        diff = await comparePage(this.client, new PageValidator(this.pagesDir), modid, live, modDir);
      } catch (err) {
        r.error = (err as Error).message;
      }
    }
    if (diff) {
      r.diff = diff.diff;
      r.diffStatus = diff.status;
      r.warnings.push(...diff.warnings);
    }
    if (live) {
      r.modDbId = live.modDbId;
      r.live = {
        name: live.name, side: live.side, type: live.type, homepage: live.homepageUrl, sourceCode: live.sourceCodeUrl, trailer: live.trailerVideoUrl,
        issueTracker: live.issueTrackerUrl, wiki: live.wikiUrl, tags: [...live.tags].sort((a, b) => Number(a > b) - Number(a < b)),
      };
      r.liveDescription = tidyHtml(live.text);
    }
    const pageId = pageIdOf(modDir) ?? live?.assetId ?? null;
    if (pageId != null) r.pageUrl = `${SITE}/show/mod/${pageId}`;

    const listed = new Set(live?.releases.map((x) => x.version) ?? []);
    r.state = r.error != null ? (r.error.startsWith("offline") ? "offline" : "error")
      : !live ? "unpublished"
      : live.isDraft && zip && !listed.has(zip.version) ? "draft-new-version"
      : live.isDraft ? "draft"
      : zip && !listed.has(zip.version) ? "new-version"
      : "uploaded";

    const liveFiles = live ? buildFiles(modid, live) : {};
    r.files = [...new Set([...Object.keys(local), ...Object.keys(liveFiles)])].sort((a, b) => Number(a > b) - Number(a < b))
      .filter((k) => live || k in local)
      .map((k) => ({ name: k, local: local[k] ?? null, live: liveFiles[k] ?? null }));
    this.addReleases(r, local, live, zip, listed);
    this.addImages(r, modid, page, live);
    for (const [name, text] of Object.entries(local)) if (name.endsWith(".html")) r.warnings.push(...htmlLint(name, text));
    if (zip && live && (r.state === "new-version" || r.state === "draft-new-version")) r.warnings.push(...versionWarnings(zip.version, [...listed]));
    if (!zip) r.warnings.push("no zip in Releases/ for this page (build the mod into Releases/, or the mod is retired)");
    addTasks(r, diff, live);
    return r;
  }

  private addReleases(r: ModReport, local: Record<string, string>, live: LiveMod | null, zip: ReleaseZip | undefined, listed: Set<string>): void {
    const fromFiles = Object.keys(local).filter((k) => k.startsWith("releases/") && k.endsWith(".json")).map((k) => path.posix.basename(k, ".json"));
    const key = (v: string) => parseTriple(v) ?? [0, 0, 0];
    const versions = [...new Set([...fromFiles, ...listed, ...(zip ? [zip.version] : [])])].sort((a, b) => compareTriple(key(b), key(a)));
    for (const v of versions) {
      const json = parse(local[releaseJsonPath(v)]);
      const games = list(json?.gameVersions);
      const liveRelease = live?.releases.find((x) => x.version === v);
      const inZip = zip?.version === v;
      r.releases.push({
        version: v, uploaded: listed.has(v), inZip, zip: inZip ? zip!.file : null, gameVersions: games,
        localChangelog: local[releaseHtmlPath(v)] ?? "", liveChangelog: liveRelease ? tidyHtml(liveRelease.changelog) : null,
      });
      if (inZip && zip!.gameVersion && games.length && !games.includes(zip!.gameVersion)) {
        r.warnings.push(`releases/${v}.json lists game versions ${games.join(", ")} but the zip says ${zip!.gameVersion}`);
      }
      if (inZip && !(local[releaseHtmlPath(v)] ?? "").trim()) r.warnings.push(`no changelog written for ${v}`);
    }
  }

  private addImages(r: ModReport, modid: string, page: Record<string, unknown> | null, live: LiveMod | null): void {
    const imagesDir = path.join(this.pagesDir, modid, IMAGES_DIR);
    const logo = s(page, "logo");
    const shots = list(page?.screenshots);
    if (!logo) r.warnings.push("page has no logo");
    if (!shots.length) r.warnings.push("page has no screenshots");
    if (!r.local.tags.length) r.warnings.push("page has no tags");
    if (!r.local.issueTracker?.trim()) r.warnings.push("no issue tracker link");
    if (!r.local.homepage?.trim()) r.warnings.push("no homepage link");

    const add = (kind: "logo" | "screenshot", name: string, liveUrl: string | null) => {
      const file = path.join(imagesDir, name);
      const exists = existsSync(file);
      r.images.push({ kind, name, localUrl: exists ? `/img/${modid}/${encodeURIComponent(name)}` : null, liveUrl });
      if (exists) r.warnings.push(...imageChecks(kind, name, readFileSync(file)));
      else r.warnings.push(`${kind} ${name} is not in moddb/${modid}/${IMAGES_DIR}/ (keep the page's images there)`);
    };
    if (logo) add("logo", logo, live?.logoUrl ?? null);
    for (const shot of shots) add("screenshot", shot, live?.screenshots.find((x) => x.fileName === shot)?.url ?? null);

    const project = this.findProject(modid);
    if (project) {
      const icon = path.join(project, "modicon.png");
      if (!existsSync(icon)) r.warnings.push(`${path.basename(project)}/modicon.png is missing (mod icon, ${IMAGE_LIMITS.iconSize}px)`);
      else r.warnings.push(...imageChecks("icon", "modicon.png", readFileSync(icon)));
    }
  }

  /** The mod's project folder next to the pages folder: a <root>/<dir>/modinfo.json whose modid matches (case-insensitive). */
  private findProject(modid: string): string | undefined {
    let dirs: string[];
    try {
      dirs = readdirSync(this.root).map((d) => path.join(this.root, d)).filter((d) => statSync(d).isDirectory());
    } catch {
      return undefined;
    }
    return dirs.find((d) => {
      try {
        const text = modInfoFromDir(d);
        return !!text && parseModInfo(text).modid.toLowerCase() === modid.toLowerCase();
      } catch {
        return false;
      }
    });
  }
}

/** ModReportBuilder.AddTasks: the checklist for publishing / updating the page by hand. */
function addTasks(r: ModReport, diff: PageDiff | null, live: LiveMod | null): void {
  const published = !!live && !live.isDraft;
  const exists = !!live;
  const id = r.modId;
  const url = r.pageUrl;
  const changelogFor = r.releases.find((x) => x.inZip && !x.uploaded)?.version ?? r.localVersion;
  if (diff?.placeholders.length) r.tasks.push({ id: `${id}:placeholders`, title: "Replace the TODO: placeholders", detail: diff.placeholders.join(", ") });
  if (!exists) r.tasks.push({ id: `${id}:create`, title: "Create the page on the site", detail: "Add mod > fill in the name, side, type and the description from moddb/. Save as a draft.", url: `${SITE}/home` });
  if (!published) r.tasks.push({ id: `${id}:description`, title: "Paste the description", detail: "Use 'Copy description' below." });
  if (live?.isDraft) r.tasks.push({ id: `${id}:publish`, title: "Set the draft to published when everything matches", detail: "Edit the page and change the status from Draft.", url: r.pageUrl });
  if (r.zip && ((!published && r.releases.every((x) => !(x.inZip && x.uploaded))) || r.state === "new-version" || r.state === "draft-new-version")) {
    r.tasks.push({ id: `${id}:upload:${changelogFor}`, title: `Upload ${r.zip} as version ${changelogFor}`, detail: "Paste the changelog and pick the game version(s) shown in the release block.", url });
  }
  if (!r.local.tags.length && (!exists || r.live?.tags.length === 0)) r.tasks.push({ id: `${id}:tags`, title: "Decide on tags and set them", detail: "Then add them to moddb/ page.json." });
  else if (!exists) r.tasks.push({ id: `${id}:tags`, title: "Set the tags", detail: r.local.tags.join(", ") });
  if (!exists || (r.live && r.images.some((i) => i.liveUrl == null && i.localUrl != null))) {
    r.tasks.push({ id: `${id}:images`, title: "Upload logo and screenshots", detail: `From moddb/${id}/${IMAGES_DIR}/; names must match page.json.` });
  }
  if (exists && (diff?.status === "changed" || diff?.status === "invalid")) {
    r.tasks.push({ id: `${id}:diff`, title: "Resolve differences between the site and moddb/", detail: "Open the diff below; edit the site or the repo, whichever is right.", url });
  }
  r.tasks.push({ id: `${id}:pull`, title: "Run pull afterwards", detail: r.pullCommand });
}
