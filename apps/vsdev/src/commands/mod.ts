// `vsdev mod <search|info|install|update|extract>`: other people's mods from ModDB (mods.vintagestory.at). install/update are a port of
// vs-mod-updater with the game's own rules (see src/mods/install.ts). Your own mods' pages are `vsdev moddb` (src/commands/moddb.ts).
import { existsSync } from "node:fs";
import path from "node:path";
import { parseCommand, table } from "../args.js";
import { bold, cyan, dim, green, red, yellow } from "../moddb/ansi.js";
import { CliError, UsageError } from "../errors.js";
import { extractFolderFor, extractZip } from "../mods/extract.js";
import { applyInstallPlan, checkUpdates, resolveInstallPlan, type Applied, type PlanEntry } from "../mods/install.js";
import { defaultLocationEnv, resolveModsDir } from "../locations.js";
import { installedIndex, scanLocalMods } from "../mods/local.js";
import { bareVersion, ModDb, resolveGameVersion } from "../mods/moddb.js";
import { loadSource, type Source } from "../mods/source.js";
import { userCwd } from "../paths.js";
import { confirm } from "../prompt.js";

export const MOD_USAGE = `Usage: vsdev mod <command> [options]       (vsdev mod <command> --help for its options)

  search <text>         find mods on ModDB
  info <mod>            a mod's details and every release with the game versions it supports
  install <mod>...      install mods (modid, alias, or modid@version) and their dependencies into a Mods folder
  update                update every mod in a Mods folder and install missing dependencies
  extract <zip>...      unpack mod zips into folders, e.g. to render their shapes

Which release to install is ModDB's pick for a game version, as the game itself asks for it: --game-version, else $VS_GAME_VERSION,
else the newest stable version. Retracted releases and mods on the game's blocklist are refused, an installed copy is never
downgraded, and an installed dependency that meets the required version is left alone.`;

const FOLDER_OPTIONS = `  -p, --data-dir <dir>   a VintagestoryData folder (its Mods/) or a Mods folder. Default for install: $VINTAGE_STORY_DATA,
                         vs-manifest.json dataDir, else ./Mods. update also falls back to the game's own data folder
                         (\`vsdev paths\` shows which is used)
  -o, --output <dir>     write the zips here instead (the scanned folder is then left untouched)
  --game-version <v>     the game version to pick releases for
  --allow-retracted      install retracted releases anyway (the game's "Install anyway")
  --source <url>         a site made by \`vsdev moddb export\` (its mods.json); mods it lists are installed from it, with
                         their sha256 checked, instead of ModDB. Repeatable
  -y, --yes              don't ask before changing files (required without a terminal)
  --json                 print the plan and results as JSON`;

const USAGES: Record<string, string> = {
  search: `Usage: vsdev mod search <text> [--limit 20] [--game-version <v>] [--json]\n\n--game-version limits the results to mods with a release for that version.`,
  info: "Usage: vsdev mod info <mod> [--json]",
  install: `Usage: vsdev mod install <mod[@version]>... [options]

Resolves the mods and their dependencies (read from modinfo.json inside each zip), shows the plan, asks, then installs and removes the
older copies they replace. For a mod project: vsdev mod install <mod> -p ./Mods -y

Options:
${FOLDER_OPTIONS}
  --no-deps              don't follow dependencies
  --force                reinstall even if the same or a newer version is there
  --extract <dir>        also unpack each installed zip into <dir>/<zip name>/`,
  update: `Usage: vsdev mod update [options]

Checks every mod in the folder against ModDB's pick for the game version, and resolves dependencies nothing installed satisfies.

Options:
${FOLDER_OPTIONS}`,
  extract: "Usage: vsdev mod extract <zip>... [--out <dir>]\n\nUnpacks each zip into <dir>/<zip name>/ (default dir: ./.vsdev/extracted). Entries pointing outside it are refused.",
};

const MARKERS: Record<PlanEntry["action"], string> = { install: "[+]", update: "[~]", current: "[=]", "newer-installed": "[=]", satisfied: "[=]", error: "[x]" };
const MARKER_COLOR: Record<PlanEntry["action"], (s: string) => string> = { install: green, update: yellow, current: dim, "newer-installed": dim, satisfied: dim, error: red };

/** One plan line, in vs-mod-updater's style. */
export function planLine(e: PlanEntry): string {
  const status =
    e.action === "install" ? `install ${e.version ?? "?"}`
    : e.action === "update" ? `${e.installedVersion ?? "?"} -> ${e.version ?? "?"}`
    : e.action === "current" ? `already installed (${e.version})`
    : e.action === "newer-installed" ? `newer version installed (${e.version})`
    : e.action === "satisfied" ? `installed ${e.version} meets ${e.minVersion ? `>= ${e.minVersion}` : "the requirement"}`
    : e.error ?? "failed";
  const reason = (e.requested ? "requested" : `dependency of ${e.requiredBy}${e.minVersion ? `, needs >= ${e.minVersion}` : ""}`) + (e.source ? `, from ${e.source}` : "");
  const color = MARKER_COLOR[e.action];
  return [`${color(MARKERS[e.action])} ${bold(e.name.padEnd(30))} ${color(status.padEnd(28))} ${dim(`(${reason})`)}`, ...e.warnings.map((w) => yellow(`    ! ${w}`))].join("\n");
}

const jsonPlan = (plan: PlanEntry[]) => plan.map(({ data: _d, existing, ...e }) => ({ ...e, existing: existing.map((m) => m.source) }));
const jsonApplied = (applied: Applied[]) => applied.map((a) => ({ modid: a.entry.modid, version: a.entry.version, file: a.file, removed: a.removed, error: a.error }));

/** The Mods folder for install (write: flag, env, config, ./Mods) or update (read: also the real game/server data folders). */
function modsFolder(given: string | undefined, mode: "read" | "write", cwd: string, json: boolean): string {
  const found = resolveModsDir({ flag: given, mode }, defaultLocationEnv(cwd));
  if (!found.path) {
    throw new CliError(`no Mods folder found (looked at ${found.candidates.map((c) => c.path).join(", ")}); pass -p <VintagestoryData or Mods folder>`, 2);
  }
  if (!json) console.log(`${dim("Mods folder:")} ${cyan(found.path!)} ${dim(`(${found.label})`)}`);
  return found.path;
}

async function gameVersionFor(db: ModDb, given: string | undefined, json: boolean): Promise<string> {
  const { version, source } = await resolveGameVersion(db, given, userCwd());
  if (!json) console.log(`${dim("Game version:")} ${cyan(version)} ${dim(`(${source})`)}`);
  return version;
}

async function apply(plan: PlanEntry[], modsDir: string, outDir: string, db: ModDb, yes: boolean, json: boolean, extractDir?: string): Promise<Applied[]> {
  const todo = plan.filter((e) => e.action === "install" || e.action === "update");
  if (!todo.length) {
    if (!json) console.log(plan.some((e) => e.action === "error") ? yellow("\nNothing to install.") : green("\nNothing to install; everything is up to date."));
    return [];
  }
  if (!(await confirm(`\nInstall/update ${todo.length} mod(s) into ${outDir}?`, yes))) {
    console.log(dim("No changes made."));
    return [];
  }
  const applied = await applyInstallPlan(plan, { modsDir, outDir, db });
  for (const a of applied) {
    if (!json) {
      console.log(a.error ? red(`[x] ${a.entry.name}: ${a.error}`) : `${green("[+]")} ${a.entry.action === "update" ? "Updated" : "Installed"} ${bold(a.entry.name)} -> ${cyan(a.entry.version ?? "?")} ${dim(`(${path.basename(a.file!)})`)}`);
      for (const r of a.removed) console.log(dim(`    removed ${r}`));
    }
    if (extractDir && a.file) {
      const into = extractFolderFor(a.file, extractDir);
      const files = extractZip(a.file, into);
      if (!json) console.log(dim(`    extracted ${files} files to ${into}`));
    }
  }
  return applied;
}

async function search(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, { limit: { type: "string" }, "game-version": { type: "string" }, json: { type: "boolean" } });
  if (values.help) return usage("search");
  if (!positionals.length) throw new UsageError("search needs some text");
  const limit = Number(values.limit ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new UsageError("--limit must be a whole number from 1 to 500");
  const db = new ModDb();
  let gameVersionIds: number[] = [];
  if (values["game-version"]) {
    const wanted = bareVersion(values["game-version"]);
    const found = (await db.gameVersions()).find((g) => bareVersion(g.name) === wanted);
    if (!found) throw new CliError(`ModDB knows no game version ${wanted}`, 2);
    gameVersionIds = [found.tagid];
  }
  const hits = await db.search(positionals.join(" "), { limit, gameVersionIds });
  if (values.json) {
    console.log(JSON.stringify(hits, null, 2));
    return 0;
  }
  if (!hits.length) {
    console.log(yellow("No mods found."));
    return 0;
  }
  console.log(table([["MODID", "NAME", "AUTHOR", "SIDE", "DOWNLOADS", "LAST RELEASE"], ...hits.map((h) => [
    h.modidstrs?.[0] ?? h.urlalias ?? String(h.modid), h.name, h.author ?? "", h.side ?? "", String(h.downloads ?? ""), (h.lastreleased ?? "").slice(0, 10),
  ])], (row, col, cell) => (row === 0 ? bold(cell) : col === 0 ? cyan(cell) : col === 1 ? bold(cell) : col === 2 || col === 5 ? dim(cell) : cell)));
  return 0;
}

async function info(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, { json: { type: "boolean" }, all: { type: "boolean" } });
  if (values.help) return usage("info");
  if (positionals.length !== 1) throw new UsageError("info takes one mod (modid or alias)");
  const mod = await new ModDb().mod(positionals[0]);
  if (!mod) throw new CliError(`no mod '${positionals[0]}' on ModDB`, 2);
  if (values.json) {
    console.log(JSON.stringify(mod, null, 2));
    return 0;
  }
  const releases = mod.releases ?? [];
  const lines = [
    `${bold(mod.name)} ${dim("by")} ${mod.author ?? "?"}`,
    `  modid ${cyan(releases[0]?.modidstr ?? "?")}, side ${mod.side ?? "?"}, ${mod.downloads ?? 0} downloads, ${mod.follows ?? 0} follows`,
    `  ${dim("page   ")} ${cyan(`https://mods.vintagestory.at/show/mod/${mod.assetid}`)}`,
  ];
  for (const [label, url] of [["home", mod.homepageurl], ["source", mod.sourcecodeurl], ["issues", mod.issuetrackerurl], ["wiki", mod.wikiurl]]) {
    if (url) lines.push(`  ${dim(label!.padEnd(7))} ${cyan(url)}`);
  }
  if (mod.tags?.length) lines.push(`  ${dim("tags   ")} ${mod.tags.join(", ")}`);
  const shown = values.all ? releases : releases.slice(0, 15);
  lines.push("", table([["VERSION", "RELEASED", "GAME VERSIONS", "FILE"], ...shown.map((r) => [r.modversion, (r.created ?? "").slice(0, 10), (r.tags ?? []).join(", "), r.filename])], (row, col, cell) => (row === 0 ? bold(cell) : col === 0 ? green(cell) : col === 1 || col === 3 ? dim(cell) : cell)));
  if (shown.length < releases.length) lines.push(dim(`... ${releases.length - shown.length} older releases (--all shows them)`));
  console.log(lines.join("\n"));
  return 0;
}

const FOLDER_ARGS = {
  "data-dir": { type: "string", short: "p" },
  path: { type: "string" },
  output: { type: "string", short: "o" },
  "game-version": { type: "string" },
  "allow-retracted": { type: "boolean" },
  source: { type: "string", multiple: true },
  yes: { type: "boolean", short: "y" },
  json: { type: "boolean" },
} as const;

/** The --source sites (mods.json from `vsdev moddb export`), loaded up front so a bad URL fails before anything is resolved. */
async function sourcesOf(urls: string[] | undefined, json: boolean): Promise<Source[]> {
  const sources: Source[] = [];
  for (const url of urls ?? []) {
    try {
      const source = await loadSource(url);
      sources.push(source);
      if (!json) console.log(`${dim("Source:")} ${cyan(source.url)} ${dim(`(${source.mods.length} mods: ${source.mods.map((m) => m.modid).join(", ")})`)}`);
    } catch (err) {
      throw new CliError(`--source ${url}: ${(err as Error).message}`, 2);
    }
  }
  return sources;
}

async function install(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, { ...FOLDER_ARGS, "no-deps": { type: "boolean" }, force: { type: "boolean" }, extract: { type: "string" } });
  if (values.help) return usage("install");
  if (!positionals.length) throw new UsageError("install needs at least one mod");
  const cwd = userCwd();
  const json = !!values.json;
  const modsDir = modsFolder(values["data-dir"] ?? values.path, "write", cwd, json);
  const outDir = values.output ? path.resolve(cwd, values.output) : modsDir;
  const db = new ModDb();
  const gameVersion = await gameVersionFor(db, values["game-version"], json);
  const sources = await sourcesOf(values.source, json);
  if (!json) console.log(dim(`Resolving ${positionals.join(", ")}${values["no-deps"] ? "" : " and dependencies"} for ${modsDir}${outDir !== modsDir ? ` (writing to ${outDir})` : ""}...\n`));
  const plan = await resolveInstallPlan(positionals.map((spec) => ({ spec })), {
    db, gameVersion, installed: installedIndex(scanLocalMods(modsDir)), deps: !values["no-deps"], allowRetracted: !!values["allow-retracted"], force: !!values.force, sources,
  });
  if (!json) for (const e of plan) console.log(planLine(e));
  const applied = await apply(plan, modsDir, outDir, db, !!values.yes, json, values.extract && path.resolve(cwd, values.extract));
  if (json) console.log(JSON.stringify({ gameVersion, plan: jsonPlan(plan), applied: jsonApplied(applied) }, null, 2));
  return plan.some((e) => e.action === "error") || applied.some((a) => a.error) ? 1 : 0;
}

async function update(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, FOLDER_ARGS);
  if (values.help) return usage("update");
  if (positionals.length) throw new UsageError("update takes no mod names (use install to add mods)");
  const cwd = userCwd();
  const json = !!values.json;
  const modsDir = modsFolder(values["data-dir"] ?? values.path, "read", cwd, json);
  if (!existsSync(modsDir)) throw new CliError(`no Mods folder at ${modsDir}`, 2);
  const outDir = values.output ? path.resolve(cwd, values.output) : modsDir;
  const db = new ModDb();
  const gameVersion = await gameVersionFor(db, values["game-version"], json);
  const sources = await sourcesOf(values.source, json);
  const result = await checkUpdates(modsDir, { db, gameVersion, allowRetracted: !!values["allow-retracted"], sources });
  const updating = new Set(result.updates.map((u) => u.modid));
  const deps = result.dependencyPlan.filter((e) => !updating.has(e.modid));
  if (!json) {
    console.log(`${dim("Scanned")} ${cyan(modsDir)}${dim(`: ${result.rows.length} mods`)}\n`);
    const mark = { update: yellow("[!]"), current: dim("[=]"), ahead: dim("[=]"), unknown: dim("[?]"), blocked: red("[x]") };
    const tint = { update: yellow, current: green, ahead: green, unknown: dim, blocked: red };
    for (const r of result.rows) {
      const status = r.status === "update" ? `${r.installed} -> ${r.latest}` : r.status === "current" ? `${r.installed} (up to date)` : `${r.installed ?? "n/a"}${r.detail ? ` -- ${r.detail}` : ""}`;
      console.log(`${mark[r.status]} ${bold(r.name.padEnd(30))} ${tint[r.status](status)}`);
      if (r.duplicates.length) console.log(yellow(`    ! also installed: ${r.duplicates.join(", ")} (the game loads only the highest version)`));
    }
    const n = (s: string) => result.rows.filter((r) => r.status === s).length;
    console.log(`\n${(n("update") ? yellow : dim)(`${n("update")} update(s) available`)}, ${green(`${n("current") + n("ahead")} up to date`)}, ${dim(`${n("unknown")} could not be checked`)}, ${(n("blocked") ? red : dim)(`${n("blocked")} blocked`)}`);
    if (deps.length) {
      console.log(bold("\nDependency check:"));
      for (const e of deps) console.log(planLine(e));
    }
  }
  const applied = await apply([...result.updates, ...deps], modsDir, outDir, db, !!values.yes, json);
  if (json) console.log(JSON.stringify({ gameVersion, mods: result.rows, dependencies: jsonPlan(deps), applied: jsonApplied(applied) }, null, 2));
  return result.rows.some((r) => r.status === "blocked") || deps.some((e) => e.action === "error") || applied.some((a) => a.error) ? 1 : 0;
}

async function extract(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, { out: { type: "string" } });
  if (values.help) return usage("extract");
  if (!positionals.length) throw new UsageError("extract needs at least one zip");
  const cwd = userCwd();
  const outDir = path.resolve(cwd, values.out ?? ".vsdev/extracted");
  for (const zip of positionals.map((z) => path.resolve(cwd, z))) {
    const into = extractFolderFor(zip, outDir);
    try {
      console.log(`${path.relative(cwd, zip)}: ${extractZip(zip, into)} files -> ${path.relative(cwd, into) || into}`);
    } catch (err) {
      throw new CliError(`${zip}: ${(err as Error).message}`);
    }
  }
  return 0;
}

function usage(command?: string): number {
  console.log(command ? USAGES[command] : MOD_USAGE);
  return 0;
}

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = { search, info, install, update, extract };

export async function runMod(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") return usage();
  const run = COMMANDS[command];
  if (!run) throw new UsageError(`unknown mod command '${command}'`);
  return run(rest);
}
