// `vsdev moddb check`: are the mod zips you built already on ModDB? A port of the `check` command of ModDbCli
// (translocator-locator-cmd: CheckCommand.cs, VersionRules.cs, ReleaseZips.cs, Reports.WriteGitHubOutputs), so a mod project's CI can
// gate on it: each zip is deployed / new-version / new-mod / error, and a new version that skips a number gets a warning.
import { appendFileSync } from "node:fs";
import type { ModDb, ModDbMod } from "../mods/moddb.js";
import { versionWarnings } from "./checks.js";
import { readReleaseZip } from "./releases.js";

export type CheckStatus = "deployed" | "new-version" | "new-mod" | "error";

export interface CheckRow {
  file: string;
  modid: string;
  version: string;
  status: CheckStatus;
  /** Versions on ModDB, newest first. */
  listedVersions: string[];
  detail: string;
  warnings: string[];
}

/** CheckCommand.Evaluate for every zip; looks each modid up once, four at a time. */
export async function checkReleases(zipPaths: string[], db: Pick<ModDb, "mod">): Promise<CheckRow[]> {
  const zips = zipPaths.map(readReleaseZip);
  const ids = [...new Set(zips.filter((z) => z.modid && z.version).map((z) => z.modid))];
  const lookups = new Map<string, { mod: ModDbMod | null; error?: string }>();
  for (let i = 0; i < ids.length; i += 4) {
    await Promise.all(ids.slice(i, i + 4).map(async (id) => {
      try {
        lookups.set(id, { mod: await db.mod(id) });
      } catch (err) {
        lookups.set(id, { mod: null, error: (err as Error).message });
      }
    }));
  }
  return zips.map((zip): CheckRow => {
    const row: CheckRow = { file: zip.file, modid: zip.modid, version: zip.version, status: "error", listedVersions: [], detail: "", warnings: [] };
    if (!zip.modid || !zip.version) {
      row.detail = "could not determine modid/version from modinfo.json or the file name";
      return row;
    }
    const { mod, error } = lookups.get(zip.modid)!;
    if (error) {
      row.detail = error;
      return row;
    }
    if (!mod) {
      row.status = "new-mod";
      return row;
    }
    row.listedVersions = mod.releases.map((r) => r.modversion);
    row.status = row.listedVersions.includes(zip.version) ? "deployed" : "new-version";
    if (row.status === "new-version") row.warnings = versionWarnings(zip.version, row.listedVersions);
    return row;
  });
}

/** Reports.WriteGitHubOutputs: `undeployed`/`any_undeployed` outputs, `::warning` annotations and a step-summary table, under Actions. */
export function writeGitHubOutputs(rows: CheckRow[], env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = console.log): void {
  const undeployed = rows.filter((r) => r.status === "new-version" || r.status === "new-mod").map((r) => r.file);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `undeployed=${JSON.stringify(undeployed)}\nany_undeployed=${undeployed.length ? "true" : "false"}\n`);
  if (env.GITHUB_ACTIONS) for (const r of rows) for (const w of r.warnings) log(`::warning title=Version number::${r.file}: ${w}`);
  if (env.GITHUB_STEP_SUMMARY) {
    const lines = ["| File | Mod | Version | Status | Warnings |", "| --- | --- | --- | --- | --- |", ...rows.map((r) => `| ${r.file} | ${r.modid} | ${r.version} | ${r.status} | ${r.warnings.join("; ")} |`)];
    appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  }
}
