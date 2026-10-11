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

  const info: ModInfo = {
    modid: String(modinfoRaw.modid ?? modinfoRaw.modID ?? "").toLowerCase(),
    name: String(modinfoRaw.name ?? modinfoRaw.modid ?? zipFileName),
    version: String(modinfoRaw.version ?? "0.0.0"),
    side: String(modinfoRaw.side ?? "Universal"),
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
