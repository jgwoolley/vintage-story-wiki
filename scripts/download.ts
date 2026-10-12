#!/usr/bin/env -S npx tsx
// JavaScript/TypeScript replacement for the old download.sh -- same job (fetch the pinned
// Vintage Story dedicated server + mods from mods.vintagestory.at), using Node's built-in fetch
// instead of curl+jq, and the pure-JS `tar` package instead of shelling out to a system `tar`
// binary -- the whole pipeline (download/ingest/build) now runs on Node alone, no OS-provided
// tool required, so CI only needs a Node runtime, not any particular OS toolset.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import * as tar from "tar";

interface Options {
  serverBranch: string;
  serverVersion: string;
  serverDir: string;
  modsDir: string;
  force: boolean;
  mods: string[]; // "modid" or "modid:version"
}

function readManifestDefaults(): { serverBranch: string; serverVersion: string; mods: string[] } {
  try {
    const manifest = JSON.parse(readFileSync("vs-manifest.json", "utf8"));
    const mods = (manifest.mods ?? []).map((m: { modid: string; version?: string }) => (m.version ? `${m.modid}:${m.version}` : m.modid));
    return { serverBranch: manifest.serverBranch ?? "stable", serverVersion: manifest.serverVersion ?? "1.22.7", mods };
  } catch {
    return { serverBranch: "stable", serverVersion: "1.22.7", mods: [] };
  }
}

function printUsage(opts: Options): void {
  console.log(`Usage: npm run download -- [options]

  --server-branch BRANCH   Vintage Story server branch (default: ${opts.serverBranch})
  --server-version VER     Vintage Story server version (default: ${opts.serverVersion})
  --server-dir DIR         Install directory for the server (default: ${opts.serverDir})
  --mod MODID[:VERSION]    Mod to install, repeatable. Omit VERSION for latest.
                           Overrides vs-manifest.json's mod list entirely if given at all.
  --force                  Re-download/reinstall even if already present
  -h, --help               Show this help

Defaults (branch/version/mods) come from vs-manifest.json unless overridden above.`);
}

function parseArgs(argv: string[]): Options {
  const defaults = readManifestDefaults();
  const opts: Options = {
    serverBranch: defaults.serverBranch,
    serverVersion: defaults.serverVersion,
    serverDir: "vs_server",
    modsDir: "Mods",
    force: false,
    mods: defaults.mods,
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

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath));
}

async function installServer(opts: Options): Promise<void> {
  if (!opts.force && existsSync(opts.serverDir) && readdirSync(opts.serverDir).length > 0) {
    console.log(`- Server already present in ${opts.serverDir}/, skipping (use --force to reinstall)`);
    return;
  }

  const archivePath = "vs_server.tar.gz";
  const url = `https://cdn.vintagestory.at/gamefiles/${opts.serverBranch}/vs_server_linux-x64_${opts.serverVersion}.tar.gz`;
  console.log(`==> Downloading Vintage Story server ${opts.serverVersion} (${opts.serverBranch})`);
  await downloadToFile(url, archivePath);

  console.log(`==> Extracting server to ${opts.serverDir}/`);
  mkdirSync(opts.serverDir, { recursive: true });
  await tar.extract({ file: archivePath, cwd: opts.serverDir });
  rmSync(archivePath, { force: true });

  console.log("✔ Server installed");
}

interface ModRelease {
  modversion: string;
  filename: string;
  mainfile: string;
}

async function installMod(spec: string, opts: Options): Promise<void> {
  const [modid, version] = spec.includes(":") ? (spec.split(/:(.+)/) as [string, string]) : [spec, undefined];

  console.log(`==> Looking up mod '${modid}'${version ? ` version ${version}` : ""}`);
  const res = await fetch(`https://mods.vintagestory.at/api/mod/${modid}`);
  if (!res.ok) throw new Error(`Could not reach mods.vintagestory.at for '${modid}': ${res.status} ${res.statusText}`);
  const data = (await res.json()) as {
    mod?: { releases?: ModRelease[]; assetid?: number; urlalias?: string | null; logofile?: string | null };
  };

  // The local modid (from this mod's own modinfo.json) is NOT reliably the same as the public
  // listing's slug (confirmed false for at least one real mod -- urlalias was null; modid/urlalias
  // only happened to match for the two originally-tested mods). `assetid` is always present and
  // `https://mods.vintagestory.at/show/mod/<assetid>` is confirmed to resolve for every mod, so
  // that's what gets linked to -- cache it here (ingest itself never touches the network).
  // `logofile` is likewise a ready-to-use absolute CDN image URL (confirmed, not a relative path
  // needing a base joined on) -- cached the same way rather than downloading the image itself,
  // since the mods.vintagestory.at CDN already serves it directly.
  if (data.mod?.assetid !== undefined) {
    mkdirSync(opts.modsDir, { recursive: true });
    writeFileSync(
      join(opts.modsDir, `${modid.toLowerCase()}.meta.json`),
      JSON.stringify(
        { assetid: data.mod.assetid, urlalias: data.mod.urlalias ?? undefined, logoUrl: data.mod.logofile ?? undefined },
        null,
        2
      )
    );
  }

  const releases = data.mod?.releases ?? [];
  const release = version ? releases.find((r) => r.modversion === version) : releases[0];

  if (!release) {
    console.error(`✘ Could not find mod '${modid}'${version ? ` version ${version}` : ""} on mods.vintagestory.at`);
    process.exitCode = 1;
    return;
  }

  const dest = join(opts.modsDir, release.filename);
  if (!opts.force && existsSync(dest)) {
    console.log(`- Mod already present: ${dest} (use --force to re-download)`);
    return;
  }

  console.log(`==> Downloading mod ${release.filename}`);
  mkdirSync(opts.modsDir, { recursive: true });
  const downloadUrl = /^https?:\/\//.test(release.mainfile) ? release.mainfile : `https://mods.vintagestory.at${release.mainfile}`;
  await downloadToFile(downloadUrl, dest);

  console.log(`✔ Mod saved to ${dest}`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  await installServer(opts);
  for (const spec of opts.mods) {
    await installMod(spec, opts);
  }

  console.log("✔ Done");
}

main().catch((err) => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
