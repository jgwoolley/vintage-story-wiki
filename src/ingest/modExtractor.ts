import AdmZip from "adm-zip";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSON5 from "json5";
import type { ModInfo } from "./types.js";

const MODS_DIR = "Mods";
const SCRATCH_MODS_DIR = ".scratch/mods";

interface ExtractedMod {
  info: ModInfo;
  extractedDir: string;
}

/** Reads modinfo.json + scans for compiled code, then extracts a mod zip into .scratch/mods/<modid>-<version>/. */
export function loadMod(zipFileName: string): ExtractedMod {
  const zipPath = join(MODS_DIR, zipFileName);
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  const modinfoEntry = entries.find((e) => e.entryName.toLowerCase() === "modinfo.json");
  if (!modinfoEntry) {
    throw new Error(`${zipFileName}: no modinfo.json found at zip root`);
  }
  const modinfoRaw = JSON5.parse(modinfoEntry.getData().toString("utf8")) as Record<string, unknown>;

  const hasCompiledCode = entries.some((e) => e.entryName.toLowerCase().endsWith(".dll"));
  const modid = String(modinfoRaw.modid ?? modinfoRaw.modID ?? "").toLowerCase();

  // A mod's own declared `modid` is NOT reliably the same string as its public mods.vintagestory.at
  // listing slug (confirmed false for at least one real mod) -- `npm run download` fetches and
  // caches the real `assetid` (always present) + `urlalias` (not always set) from the API
  // alongside the zip itself, since ingest never touches the network. Falls back to undefined
  // (no link rendered) if this mod was downloaded before that caching existed.
  const metaPath = join(MODS_DIR, `${modid}.meta.json`);
  let assetid: number | undefined;
  let urlalias: string | undefined;
  if (existsSync(metaPath)) {
    try {
      const meta = JSON5.parse(readFileSync(metaPath, "utf8")) as { assetid?: number; urlalias?: string };
      assetid = meta.assetid;
      urlalias = meta.urlalias;
    } catch {
      // Malformed/missing cache file -- just means no outbound link, not a fatal ingest error.
    }
  }

  const info: ModInfo = {
    modid,
    name: String(modinfoRaw.name ?? modinfoRaw.modid ?? zipFileName),
    version: String(modinfoRaw.version ?? "0.0.0"),
    side: String(modinfoRaw.side ?? "Universal"),
    type: modinfoRaw.type as string | undefined,
    website: modinfoRaw.website as string | undefined,
    assetid,
    urlalias,
    authors: (modinfoRaw.authors as string[]) ?? [],
    description: modinfoRaw.description as string | undefined,
    dependencies: (modinfoRaw.dependencies as Record<string, string>) ?? {},
    hasCompiledCode,
    isVanilla: false,
  };

  const extractedDir = join(SCRATCH_MODS_DIR, `${info.modid}-${info.version}`);
  const markerFile = join(extractedDir, ".extracted-from");
  const alreadyExtracted = existsSync(markerFile) && readFileSync(markerFile, "utf8") === zipFileName;

  if (!alreadyExtracted) {
    rmSync(extractedDir, { recursive: true, force: true });
    mkdirSync(extractedDir, { recursive: true });
    zip.extractAllTo(extractedDir, true);
    writeFileSync(markerFile, zipFileName);
  }

  return { info, extractedDir };
}

export function listModZips(): string[] {
  if (!existsSync(MODS_DIR)) return [];
  return readdirSync(MODS_DIR).filter((f) => f.toLowerCase().endsWith(".zip"));
}
