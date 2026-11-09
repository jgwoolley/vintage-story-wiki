// `vsdev paths`: every location vsdev reads or writes, what it resolved to and why (flag, env, vs-manifest.json, the working directory, or
// a real install), so "where will this go?" can be answered before running anything. Same resolver as the commands (src/locations.ts).
import { bold, cyan, dim, green, red } from "../moddb/ansi.js";
import { parseCommand } from "../args.js";
import {
  defaultLocationEnv, findConfig, gameInfo, resolveGameDir, resolveGameVersionLocal, resolveModsDir, resolveProjectDir, resolveWikiUrl,
  type Resolved,
} from "../locations.js";
import { userCwd } from "../paths.js";

export const PATHS_USAGE = `Usage: vsdev paths [--json]

Shows where each location resolves, in vsdev's order: 1 flag, 2 env, 3 vs-manifest.json (nearest, in this folder or a parent),
4 this folder, 5 where the game is really installed (reads only; writes and downloads stop at 4).`;

interface Row {
  name: string;
  path?: string;
  from?: string;
  note?: string;
  candidates: { path: string; from: string; ok: boolean }[];
}

const row = (name: string, r: Resolved, note?: string): Row => ({
  name, path: r.path, from: r.label, note,
  candidates: r.candidates.map((c) => ({ path: c.path, from: `${c.tier}: ${c.label}`, ok: c.ok })),
});

export async function runPaths(argv: string[]): Promise<number> {
  const { values } = parseCommand(argv, { json: { type: "boolean" } });
  if (values.help) {
    console.log(PATHS_USAGE);
    return 0;
  }
  const e = defaultLocationEnv(userCwd());
  const config = findConfig(e.cwd);
  const describeGame = (r: Resolved) => {
    const info = r.path ? gameInfo(r.path) : undefined;
    return info ? `${info.kind}${info.version ? ` ${info.version}` : ""}` : r.path ? "not a game install" : "none found";
  };
  const gameRead = resolveGameDir({ mode: "read" }, e);
  const clientRead = resolveGameDir({ mode: "read", needClient: true }, e);
  const version = resolveGameVersionLocal(undefined, e);
  const rows: Row[] = [
    row("game install (reads: wiki ingest, render, version)", gameRead, describeGame(gameRead)),
    row("game client (render textures)", clientRead, describeGame(clientRead)),
    row("vsdev game / download target", resolveGameDir({ mode: "write" }, e)),
    row("Mods: vsdev mod install / download", resolveModsDir({ mode: "write" }, e)),
    row("Mods: vsdev mod update", resolveModsDir({ mode: "read" }, e)),
    row("Releases (built mod zips)", resolveProjectDir("releasesDir", undefined, e)),
    row("moddb pages", resolveProjectDir("pagesDir", undefined, e)),
    row("wiki (vsdev search)", resolveWikiUrl(undefined, e)),
    { name: "game version", path: version.version, from: version.label ?? "newest stable on ModDB (asked when needed)", candidates: [] },
  ];
  if (values.json) {
    console.log(JSON.stringify({ cwd: e.cwd, config: config?.file ?? null, locations: rows }, null, 2));
    return 0;
  }
  console.log(`${dim("working directory:")} ${e.cwd}`);
  console.log(`${dim("vs-manifest.json: ")} ${config?.file ?? dim("(none here or above)")}`);
  for (const r of rows) {
    console.log(`\n${bold(r.name)}\n  ${dim("->")} ${r.path ? cyan(r.path) : dim("(none)")}${r.from ? `  ${dim(`[${r.from}]`)}` : ""}${r.note ? `  ${r.note}` : ""}`);
    for (const c of r.candidates) console.log(`     ${c.ok ? green("+") : red("-")} ${dim(c.from.padEnd(44))} ${c.path}`);
  }
  return 0;
}
