#!/usr/bin/env -S npx tsx
// `npm run download`: fetch the pinned Vintage Story dedicated server + mods (vs-manifest.json) into ./vintagestory and Mods/. The
// downloading itself is vsdev's (the same code as `vsdev game` / `vsdev download`: official CDN, pure-JS tar, ModDB); this wrapper
// adds what only the wiki needs: each mod's ModDB listing cached as Mods/<modid>.meta.json (ingest never touches the network) and the
// run's timings in downloadTiming.json for the /<lang>/build/ page.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path, { join } from "node:path";
import { installManifestMod } from "@nf3t/vsdev/download/manifest.js";
import { installServer } from "@nf3t/vsdev/game/download.js";
import { defaultLocationEnv, resolveGameDir, resolveModsDir } from "@nf3t/vsdev/locations.js";
import { formatSpec, ModDb, parseModSpec } from "@nf3t/vsdev/mods/moddb.js";
import type { DownloadAction, DownloadTiming, ModDownloadResult, VsManifest } from "../src/ingest/types.js";

// Written to the same `site/_data/generated/` directory the ingest pipeline writes to (see `src/ingest/write.ts`); surfaced on the
// site's `/<lang>/build/` page alongside the ingest and Eleventy-build phase timings.
const TIMING_OUT_DIR = "apps/vs-wiki/site/_data/generated";

function writeDownloadTiming(timing: DownloadTiming): void {
  mkdirSync(TIMING_OUT_DIR, { recursive: true });
  writeFileSync(join(TIMING_OUT_DIR, "downloadTiming.json"), JSON.stringify(timing, null, 2));
}

interface Options {
  serverBranch: string;
  serverVersion: string;
  serverDir: string;
  modsDir: string;
  force: boolean;
  mods: string[]; // "modid" or "modid:version" / "modid@version"
  urls: Map<string, string>; // modid (lower case) -> the manifest entry's direct download `url` (draft mods the API doesn't list)
}

function readManifestDefaults(): { serverBranch: string; serverVersion: string; mods: string[]; urls: Map<string, string> } {
  try {
    const manifest = JSON.parse(readFileSync("vs-manifest.json", "utf8")) as Partial<VsManifest>;
    const mods = (manifest.mods ?? []).map((m) => formatSpec(m.modid, m.version));
    const urls = new Map((manifest.mods ?? []).filter((m) => m.url).map((m) => [m.modid.toLowerCase(), m.url!]));
    return { serverBranch: manifest.serverBranch ?? "stable", serverVersion: manifest.serverVersion ?? "1.22.7", mods, urls };
  } catch {
    return { serverBranch: "stable", serverVersion: "1.22.7", mods: [], urls: new Map() };
  }
}

function printUsage(opts: Options): void {
  console.log(`Usage: npm run download -- [options]

  --server-branch BRANCH   Vintage Story server branch (default: ${opts.serverBranch})
  --server-version VER     Vintage Story server version (default: ${opts.serverVersion})
  --server-dir DIR         Install directory for the server (default: ${opts.serverDir})
  --mod MODID[@VERSION]    Mod to install, repeatable. Omit VERSION for latest.
                           Overrides vs-manifest.json's mod list entirely if given at all.
  --force                  Re-download/reinstall even if already present
  -h, --help               Show this help

Defaults (branch/version/mods) come from vs-manifest.json unless overridden above.
For other projects, the same downloads are \`vsdev game\` / \`vsdev download\` / \`vsdev mod\` (apps/vsdev).`);
}

function parseArgs(argv: string[]): Options {
  const defaults = readManifestDefaults();
  // Where to: --server-dir, $VINTAGE_STORY, vs-manifest.json gameDir, else ./vintagestory (an old ./vs_server is reused); mods: $VINTAGE_STORY_DATA, dataDir, else ./Mods
  // (vsdev's location rule; writes never go into a real installed game).
  const e = defaultLocationEnv(process.cwd());
  const relative = (p: string) => path.relative(process.cwd(), p) || ".";
  const opts: Options = {
    ...defaults,
    serverDir: relative(resolveGameDir({ mode: "write" }, e).path!),
    modsDir: relative(resolveModsDir({ mode: "write" }, e).path!),
    force: false,
  };
  let modsFromCli: string[] | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.includes("=") ? arg.split(/=(.*)/s) : [arg, undefined];
    const next = () => inlineValue ?? argv[++i];
    switch (flag) {
      case "--server-branch":
        opts.serverBranch = next();
        break;
      case "--server-version":
        opts.serverVersion = next();
        break;
      case "--server-dir":
        opts.serverDir = next();
        break;
      case "--mod":
        (modsFromCli ??= []).push(next());
        break;
      case "--force":
        opts.force = true;
        break;
      case "-h":
      case "--help":
        printUsage(opts);
        process.exit(0);
        break;
      default:
        console.error(`✘ Unknown argument: ${arg}`);
        printUsage(opts);
        process.exit(1);
    }
  }

  if (modsFromCli) opts.mods = modsFromCli;
  return opts;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  const db = new ModDb();

  const serverStartedAt = Date.now();
  const serverAction = await installServer({ branch: opts.serverBranch, version: opts.serverVersion, dir: opts.serverDir, force: opts.force });
  const serverDurationMs = Date.now() - serverStartedAt;
  const modActions: ModDownloadResult[] = [];
  for (const spec of opts.mods) {
    const modid = parseModSpec(spec).id;
    // A per-mod lookup/download failure (bad modid, network blip) shouldn't take down the whole run or leave no timing data
    // behind -- record it as "failed" and keep going with the rest of the manifest.
    let action: DownloadAction;
    const modStartedAt = Date.now();
    try {
      const url = opts.urls.get(modid.toLowerCase());
      const result = await installManifestMod(spec, { db, modsDir: opts.modsDir, force: opts.force, url });
      // The local modid (from the mod's own modinfo.json) is NOT reliably the listing's slug (urlalias was null for at least one real
      // mod), but `assetid` is always there and https://mods.vintagestory.at/show/mod/<assetid> always resolves, so that is what the
      // wiki links to. `logofile` is an absolute CDN image URL, cached as-is rather than downloading the image.
      if (result.mod?.assetid !== undefined) {
        mkdirSync(opts.modsDir, { recursive: true });
        writeFileSync(
          join(opts.modsDir, `${modid.toLowerCase()}.meta.json`),
          JSON.stringify({ assetid: result.mod.assetid, urlalias: result.mod.urlalias ?? undefined, logoUrl: result.mod.logofile ?? undefined }, null, 2),
        );
      } else if (url && result.file) {
        // A draft mod (installed from its direct link): no API listing, so no assetid or logo. Its page is public by direct link at
        // mods.vintagestory.at/<alias>, and the drafts this is for use their modid as the alias.
        writeFileSync(join(opts.modsDir, `${modid.toLowerCase()}.meta.json`), JSON.stringify({ urlalias: modid.toLowerCase() }, null, 2));
      }
      if (result.error) {
        console.error(`✘ ${result.error}`);
        process.exitCode = 1;
      }
      action = result.action;
    } catch (err) {
      console.error(`✘ ${modid}: ${(err as Error).message}`);
      process.exitCode = 1;
      action = "failed";
    }
    modActions.push({ modid, action, durationMs: Date.now() - modStartedAt });
  }

  const timing: DownloadTiming = {
    durationMs: Date.now() - startedAt,
    finishedAtIso: new Date().toISOString(),
    serverAction,
    serverDurationMs,
    modActions,
    anyDownloaded: serverAction === "downloaded" || modActions.some((m) => m.action === "downloaded"),
  };
  writeDownloadTiming(timing);

  console.log("✔ Done");
}

main().catch((err) => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
