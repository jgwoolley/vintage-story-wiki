// `vsdev moddb <check|status|scaffold|pull|diff|serve|export>`: your own mods' pages on mods.vintagestory.at, kept in source control in
// moddb/<modid>/ and compared with the site. A port of ModDbCli (translocator-locator-cmd), usable from any mod project: the mods come
// from the built zips in ./Releases (the VS mod template's output). Exit codes as there: 0 ok, 1 a condition was met (a difference, a
// --fail-if-*), 2 a lookup failed or the input was unusable.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCommand, table } from "../args.js";
import { CliError, UsageError } from "../errors.js";
import { defaultLocationEnv, resolveProjectDir } from "../locations.js";
import { bold, cyan, dim, green, modLine, red, redError, yellow } from "../moddb/ansi.js";
import { checkReleases, writeGitHubOutputs, type CheckRow } from "../moddb/check.js";
import { comparePage, newDiff, type PageDiff } from "../moddb/compare.js";
import { exportSite } from "../moddb/export.js";
import { PLACEHOLDER, readLocal, releaseHtmlPath } from "../moddb/files.js";
import { LiveClient, liveLookup } from "../moddb/live.js";
import { planPull } from "../moddb/pull.js";
import { localMods, releaseZips, selectMods } from "../moddb/releases.js";
import { ReportBuilder } from "../moddb/report.js";
import { ensureSchema, scaffold, sourceCodeUrl } from "../moddb/scaffold.js";
import { startReviewServer } from "../moddb/server.js";
import { PageValidator } from "../moddb/validate.js";
import { ModDb } from "../mods/moddb.js";
import { userCwd } from "../paths.js";
import { confirm } from "../prompt.js";

export const MODDB_USAGE = `Usage: vsdev moddb <command> [options] [modid...]      (vsdev moddb <command> --help for its options)

Your mods' pages on mods.vintagestory.at, kept in moddb/<modid>/ and compared with the site. The mods are the zips in Releases/.

  check       is each zip in Releases/ on ModDB yet? (deployed / new-version / new-mod; for CI)
  status      per mod: local version, newest listed, changelog drafted, page written
  scaffold    placeholder pages for mods that aren't published yet
  pull        rewrite moddb/<modid>/ from the live pages (asks before overwriting local edits)
  diff        live pages vs moddb/; exit 1 when they differ
  serve       a local review page: checklist, Local / Site / Diff per section, copy buttons
  export      a static site of your mod pages with the newest zips, for GitHub Pages

Shared options:
  --releases-dir <dir>  built zips (default: vs-manifest.json releasesDir, else ./Releases)
  --pages-dir <dir>     page sources (default: vs-manifest.json pagesDir, else ./moddb)
  --offline             don't touch the network (network-only commands exit 0 doing nothing)
  --json                JSON output

Typical first upload: scaffold, write the TODO: placeholders (diff --fail-if-placeholders exits 1 until done), put the logo and screenshots in
moddb/<modid>/images/, then serve and follow its checklist; afterwards pull. New version: write moddb/<modid>/releases/<version>.html,
upload, pull.`;

const USAGES: Record<string, string> = {
  check: "Usage: vsdev moddb check [<dir or zip>...] [--fail-if-undeployed|--fail-if-deployed|--fail-if-skipped] [--json]\n\nDefault input: the releases folder. Under GitHub Actions also writes undeployed/any_undeployed outputs, a step summary and ::warning lines.",
  status: "Usage: vsdev moddb status [--json]",
  scaffold: "Usage: vsdev moddb scaffold [modid...] [--force] [--offline]\n\nPublished mods are skipped (use pull); offline, every mod without a folder gets one. Also writes page.schema.json into the pages folder if missing.",
  pull: "Usage: vsdev moddb pull [modid...] [-y]\n\nOverwrites local files that differ from the live page after asking (-y skips the question; required without a terminal).",
  diff: "Usage: vsdev moddb diff [modid...] [--fail-if-placeholders] [--json]",
  serve: "Usage: vsdev moddb serve [modid...] [--port 5173] [--no-open] [--offline]\n\nRead-only except for the checklist progress in <pages>/.progress.json. Listens on 127.0.0.1 only.",
  export: "Usage: vsdev moddb export [modid...] [--out .vsdev/site] [--title <text>] [--offline]\n\nA static site: index, a page per mod (description, screenshots, tags, links, releases with changelogs) and the newest zip from\nReleases/, plus mods.json for `vsdev mod install <modid> --source <site url>`. No checklist, diffs or warnings go into it.\nPublish the folder with GitHub Pages (upload-pages-artifact) or any static host.",
};

const SHARED = {
  "releases-dir": { type: "string" },
  "pages-dir": { type: "string" },
  offline: { type: "boolean" },
  json: { type: "boolean" },
} as const;

interface Ctx {
  releasesDir: string;
  pagesDir: string;
  offline: boolean;
  json: boolean;
  modids: string[];
}

function context(values: { "releases-dir"?: string; "pages-dir"?: string; offline?: boolean; json?: boolean }, positionals: string[], { needReleases = true } = {}): Ctx {
  const e = defaultLocationEnv(userCwd());
  const releasesDir = resolveProjectDir("releasesDir", values["releases-dir"], e).path!;
  const pagesDir = resolveProjectDir("pagesDir", values["pages-dir"], e).path!;
  if (needReleases && !existsSync(releasesDir)) throw new CliError(`releases folder not found: ${releasesDir} (build your mods into it, or pass --releases-dir)`, 2);
  return { releasesDir, pagesDir, offline: !!values.offline, json: !!values.json, modids: positionals };
}

/** Runs `work` for each item, four at a time, keeping the input order (ModDbCli's ForEachAsync). */
async function forEach<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  }));
  return out;
}

const offlineSkip = (ctx: Ctx) => {
  if (!ctx.offline) return false;
  console.log("offline: skipped");
  return true;
};

const stateColor = (state: string) =>
  ["deployed", "uploaded", "yes"].includes(state) ? green(state)
  : ["new-version", "new-mod", "NOT UPLOADED", "no", "not published"].includes(state) || state.startsWith("draft") ? yellow(state)
  : state.startsWith("error") ? red(state)
  : state;

async function check(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, { ...SHARED, "fail-if-undeployed": { type: "boolean" }, "fail-if-deployed": { type: "boolean" }, "fail-if-skipped": { type: "boolean" } });
  if (values.help) return usage("check");
  const ctx = context(values, [], { needReleases: !positionals.length });
  if (offlineSkip(ctx)) return 0;
  const cwd = userCwd();
  const inputs = positionals.length ? positionals.map((p) => path.resolve(cwd, p)) : [ctx.releasesDir];
  const missing = inputs.filter((p) => !existsSync(p));
  if (missing.length) throw new CliError(`not found: ${missing.join(", ")}`, 2);
  const zips = releaseZips(inputs);
  if (!zips.length) throw new CliError(`no zip files in ${inputs.join(", ")}`, 2);
  const rows = await checkReleases(zips, new ModDb());
  console.log(ctx.json ? JSON.stringify(rows, null, 2) : checkTable(rows));
  writeGitHubOutputs(rows);
  if (rows.some((r) => r.status === "error")) {
    console.error(redError("\nSome lookups failed; see the detail column."));
    return 2;
  }
  if (values["fail-if-undeployed"] && rows.some((r) => r.status === "new-version" || r.status === "new-mod")) return 1;
  if (values["fail-if-deployed"] && rows.some((r) => r.status === "deployed")) return 1;
  if (values["fail-if-skipped"] && rows.some((r) => r.warnings.length)) return 1;
  return 0;
}

function checkTable(rows: CheckRow[]): string {
  const out = table([["FILE", "MODID", "VERSION", "STATUS", "LISTED (newest first)"], ...rows.map((r) => {
    const listed = r.listedVersions.slice(0, 4).join(", ") + (r.listedVersions.length > 4 ? ", ..." : "");
    return [r.file, r.modid || "?", r.version || "?", r.status, listed || r.detail || "-"];
  })], (row, col, cell) => (row === 0 ? bold(cell) : col === 3 ? stateColor(cell) : col === 1 ? cyan(cell) : cell));
  const warnings = rows.flatMap((r) => r.warnings.map((w) => yellow(`WARNING ${r.file}: ${w}`)));
  return out + (warnings.length ? `\n\n${warnings.join("\n")}` : "");
}

async function status(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, SHARED);
  if (values.help) return usage("status");
  const ctx = context(values, positionals);
  if (offlineSkip(ctx)) return 0;
  const client = new LiveClient();
  const zips = localMods(ctx.releasesDir);
  const rows = await forEach(selectMods(zips, ctx.modids).map((m) => zips.get(m)!), async (zip) => {
    const modDir = path.join(ctx.pagesDir, zip.modid);
    const row = { modId: zip.modid, local: zip.version, listed: "", state: "", changelog: false, pageAuthored: false };
    try {
      const mod = await liveLookup(client, zip.modid, modDir);
      const listed = mod?.releases.map((r) => r.version);
      row.state = !listed ? "not published" : mod!.isDraft ? (listed.includes(zip.version) ? "draft (uploaded)" : "draft (NOT UPLOADED)") : listed.includes(zip.version) ? "uploaded" : "NOT UPLOADED";
      row.listed = !listed ? "" : listed[0] ?? "-";
    } catch (err) {
      row.state = `error: ${(err as Error).message}`;
    }
    const changelog = path.join(modDir, releaseHtmlPath(zip.version));
    row.changelog = existsSync(changelog) && !readFileSync(changelog, "utf8").includes(PLACEHOLDER);
    row.pageAuthored = existsSync(modDir) && !Object.entries(readLocal(modDir)).some(([k, v]) => k.endsWith(".html") && v.includes(PLACEHOLDER));
    return row;
  });
  if (ctx.json) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(table([["MODID", "LOCAL", "NEWEST LISTED", "STATE", "CHANGELOG DRAFTED", "PAGE AUTHORED"], ...rows.map((r) => [r.modId, r.local, r.listed || "-", r.state, r.changelog ? "yes" : "no", r.pageAuthored ? "yes" : "no"])],
      (row, col, cell) => (row === 0 ? bold(cell) : col === 0 ? cyan(cell) : col >= 3 ? stateColor(cell) : cell)));
  }
  return rows.some((r) => r.state.startsWith("error")) ? 2 : 0;
}

async function scaffoldCmd(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, { ...SHARED, force: { type: "boolean" } });
  if (values.help) return usage("scaffold");
  const ctx = context(values, positionals);
  const known = localMods(ctx.releasesDir);
  const url = sourceCodeUrl(userCwd());
  const client = ctx.offline ? null : new LiveClient();
  if (ensureSchema(ctx.pagesDir)) console.log(dim(`wrote ${path.join(ctx.pagesDir, "page.schema.json")}`));
  let failed = false;
  for (const modid of selectMods(known, ctx.modids)) {
    const modDir = path.join(ctx.pagesDir, modid);
    if (client) {
      try {
        if (await client.mod(modid)) {
          console.log(modLine(modid, "already published, skipped (use pull)", dim));
          continue;
        }
      } catch (err) {
        console.error(modLine(modid, `error: ${(err as Error).message}`, redError));
        failed = true;
        continue;
      }
    } else if (existsSync(modDir) && !values.force) {
      console.log(modLine(modid, "page exists, skipped", dim));
      continue;
    }
    const written = scaffold(known.get(modid)!, modDir, url, !!values.force);
    console.log(written.length ? modLine(modid, `created ${written.join(", ")}`, green) : modLine(modid, "nothing to create", dim));
  }
  return failed ? 2 : 0;
}

async function pull(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, { ...SHARED, yes: { type: "boolean", short: "y" } });
  if (values.help) return usage("pull");
  const ctx = context(values, positionals);
  if (offlineSkip(ctx)) return 0;
  const client = new LiveClient();
  const modids = selectMods(localMods(ctx.releasesDir), ctx.modids);
  const plans = await forEach(modids, async (modid) => {
    try {
      return { modid, plan: await planPull(client, ctx.pagesDir, modid) };
    } catch (err) {
      return { modid, error: (err as Error).message };
    }
  });
  const overwrites = plans.filter((p) => p.plan?.overwrites.length);
  if (overwrites.length && !values.yes) {
    console.log(yellow("These local files differ from the live page and would be overwritten (changes not yet on the site are lost):"));
    for (const p of overwrites) for (const name of p.plan!.overwrites) console.log(`  ${cyan(p.modid)}/${name}`);
    console.log(dim("Run `vsdev moddb diff` to see the differences."));
    const count = overwrites.reduce((n, p) => n + p.plan!.overwrites.length, 0);
    if (!process.stdin.isTTY) {
      console.error(redError("Not a terminal, so nothing was asked or written. Pass --yes to overwrite."));
      return 2;
    }
    if (!(await confirm(`Overwrite ${count} file(s)?`, false))) {
      console.log("Aborted, nothing was written.");
      return 1;
    }
  }
  let failed = false;
  for (const p of plans) {
    if (p.error) {
      console.error(modLine(p.modid, `error: ${p.error}`, redError));
      failed = true;
      continue;
    }
    const plan = p.plan!;
    if (!plan.published) {
      console.log(modLine(p.modid, plan.hasFolder ? "not published, placeholder page left alone" : "not published, skipped (run scaffold to create a placeholder page)", yellow));
      continue;
    }
    for (const [name, data] of plan.writes) {
      const file = path.join(ctx.pagesDir, p.modid, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, data);
    }
    console.log(modLine(p.modid, `${plan.writes.size} file(s) written, ${plan.total - plan.writes.size} unchanged`, plan.writes.size ? green : dim));
  }
  return failed ? 2 : 0;
}

const colorDiff = (diff: string) => diff.replace(/\n$/, "").split("\n").map((line) =>
  line.startsWith("+++") || line.startsWith("---") ? bold(line)
  : line.startsWith("@@") ? cyan(line)
  : line.startsWith("+") ? green(line)
  : line.startsWith("-") ? red(line)
  : line.startsWith("Binary file") ? yellow(line)
  : line).join("\n");

async function diff(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, { ...SHARED, "fail-if-placeholders": { type: "boolean" } });
  if (values.help) return usage("diff");
  const ctx = context(values, positionals);
  if (offlineSkip(ctx)) return 0;
  const client = new LiveClient();
  const validator = new PageValidator(ctx.pagesDir);
  const modids = selectMods(localMods(ctx.releasesDir), ctx.modids);
  const diffs = await forEach(modids, async (modid): Promise<PageDiff> => {
    const modDir = path.join(ctx.pagesDir, modid);
    try {
      return await comparePage(client, validator, modid, await liveLookup(client, modid, modDir), modDir);
    } catch (err) {
      return { ...newDiff(modid), status: "error", detail: (err as Error).message };
    }
  });
  if (ctx.json) console.log(JSON.stringify(diffs.map(({ published: _p, ...d }) => d), null, 2));
  else {
    const lines: string[] = diffs.filter((d) => d.diff).map((d) => colorDiff(d.diff));
    for (const d of diffs) {
      let note = d.status === "same" ? green("in sync")
        : d.status === "scaffolded" ? yellow(d.placeholders.length ? "not published (placeholder page)" : "not published (local page ready)")
        : d.status === "missing-scaffold" ? yellow("not published, no page yet (run scaffold)")
        : d.status === "error" ? red(`error: ${d.detail}`)
        : d.status === "invalid" ? red("INVALID page.json")
        : red(`DIFFERS (${[...d.changed, ...d.removed.map((n) => `${n} (gone live)`)].join(", ")})`);
      if (d.pending.length) note += dim(`; pending local: ${d.pending.join(", ")}`);
      lines.push(`${cyan(d.modId)}: ${note}`);
      lines.push(...d.warnings.map((w) => yellow(`WARNING ${d.modId}: ${w}`)));
    }
    console.log(lines.join("\n"));
  }
  if (diffs.some((d) => d.status === "error")) return 2;
  if (diffs.some((d) => d.status === "changed" || d.status === "invalid")) return 1;
  return values["fail-if-placeholders"] && diffs.some((d) => d.placeholders.length) ? 1 : 0;
}

async function serve(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, { ...SHARED, port: { type: "string" }, "no-open": { type: "boolean" } });
  if (values.help) return usage("serve");
  const ctx = context(values, positionals);
  const port = Number(values.port ?? 5173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError("--port must be a port number");
  let modids = selectMods(localMods(ctx.releasesDir), ctx.modids);
  if (!ctx.modids.length && existsSync(ctx.pagesDir)) {
    // Pages without a zip (a retired mod, or not built yet) are listed too.
    const pageOnly = readdirSync(ctx.pagesDir).filter((d) => !d.startsWith(".") && statSync(path.join(ctx.pagesDir, d)).isDirectory() && !modids.includes(d));
    modids = [...modids, ...pageOnly].sort();
  }
  const builder = new ReportBuilder(ctx.releasesDir, ctx.pagesDir, () => new LiveClient(ctx.offline ? null : new ModDb()));
  let server;
  try {
    server = await startReviewServer(builder, modids, port);
  } catch (err) {
    throw new CliError(`cannot listen on port ${port}: ${(err as Error).message}`, 2);
  }
  console.log(`vsdev moddb: ${server.url}  (Ctrl+C to stop; read-only apart from ${path.join(ctx.pagesDir, ".progress.json")})`);
  if (!values["no-open"]) openBrowser(server.url);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  await server.close();
  return 0;
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // no browser available; the URL is printed
  }
}

async function exportCmd(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, { ...SHARED, out: { type: "string" }, title: { type: "string" } });
  if (values.help) return usage("export");
  const ctx = context(values, positionals, { needReleases: false });
  const zips = existsSync(ctx.releasesDir) ? localMods(ctx.releasesDir) : new Map();
  const pageDirs = existsSync(ctx.pagesDir) ? readdirSync(ctx.pagesDir).filter((d) => existsSync(path.join(ctx.pagesDir, d, "page.json"))).sort() : [];
  const unknown = ctx.modids.filter((m) => !pageDirs.includes(m));
  if (unknown.length) throw new UsageError(`no page for ${unknown.join(", ")} in ${ctx.pagesDir} (run vsdev moddb scaffold or pull first)`);
  const modids = ctx.modids.length ? ctx.modids : pageDirs;
  if (!modids.length) throw new CliError(`no pages in ${ctx.pagesDir} (run vsdev moddb scaffold or pull first)`, 2);
  const outDir = path.resolve(userCwd(), values.out ?? ".vsdev/site");
  let result;
  try {
    result = await exportSite({ pagesDir: ctx.pagesDir, outDir, modids, zips, client: ctx.offline ? null : new LiveClient(), title: values.title });
  } catch (err) {
    throw new CliError((err as Error).message, 2);
  }
  if (ctx.json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const m of result.mods) console.log(`${cyan(m.modid)}: ${m.page}${m.files.length ? `, ${m.files.join(", ")}` : ""}`);
    for (const w of result.warnings) console.log(yellow(`WARNING ${w}`));
    console.log(`\nSite written to ${outDir} (open index.html, or publish the folder with GitHub Pages).`);
  }
  return 0;
}

function usage(command?: string): number {
  console.log(command ? USAGES[command] : MODDB_USAGE);
  return 0;
}

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = { check, status, scaffold: scaffoldCmd, pull, diff, serve, export: exportCmd };

export async function runModdb(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") return usage();
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!run) throw new UsageError(`unknown moddb command '${command}'`);
  return run(rest);
}
