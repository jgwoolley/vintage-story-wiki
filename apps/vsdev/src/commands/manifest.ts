// `vsdev manifest freeze|install`: vs-manifest.json as a requirements file. freeze writes the mods found in a folder into the file's
// `mods` (like `pip freeze`); install downloads the file's mods into a folder (like `pip install -r`, without the game server).
import path from "node:path";
import { existsSync } from "node:fs";
import { parseCommand } from "../args.js";
import { CliError, UsageError } from "../errors.js";
import { defaultLocationEnv, findConfig, resolveModsDir, resolveProjectDir } from "../locations.js";
import { bold, cyan, dim, green, red, yellow } from "../moddb/ansi.js";
import { userCwd } from "../paths.js";
import { confirm } from "../prompt.js";
import { runDownload } from "./download.js";
import { defaultManifestFile, mergePins, pinsFromModsFolder, pinsFromReleases, readManifestMods, writeManifestMods, type Change } from "../manifest/edit.js";

export const MANIFEST_USAGE = `Usage: vsdev manifest <command> [options]

vs-manifest.json works like a requirements file: its "mods" list pins what a project needs.

  freeze [--from mods|releases]   write the mods found in a folder into the manifest
  install                         download the manifest's mods into a folder (no game server; pin dependencies too)

freeze options:
  --from mods|releases  where the mods are: your Mods folder (default), or ./Releases, a mod project's built zips
  -p, --data-dir <dir>  the Mods folder (or a data folder holding it) for --from mods; default by the location rule (\`vsdev paths\`)
  --releases-dir <dir>  the zips for --from releases (default: vs-manifest.json releasesDir, else ./Releases)
  --manifest <file>     the manifest to update (default: the nearest vs-manifest.json; one is created here if there is none)
  --prune               also remove listed mods the folder doesn't have (default: only add new mods and update versions)
  --dry-run             show the changes, write nothing
  -y, --yes             write without asking (needed without a terminal)
  --json                machine-readable result

Only "mods" is changed; the file is rewritten as two-space JSON. Entries keep their order, new mods go at the end.

install options: --manifest, -p/--data-dir (where the mods go), --force (download again), as \`vsdev download --help\` says.`;

const MARK: Record<Change["action"], (s: string) => string> = { add: green, update: yellow, remove: red, same: dim };
const SIGN: Record<Change["action"], string> = { add: "[+]", update: "[~]", remove: "[-]", same: "[=]" };

async function freeze(argv: string[]): Promise<number> {
  const { values } = parseCommand(argv, {
    from: { type: "string" }, "data-dir": { type: "string", short: "p" }, "mods-dir": { type: "string" }, "releases-dir": { type: "string" },
    manifest: { type: "string" }, prune: { type: "boolean" }, "dry-run": { type: "boolean" }, yes: { type: "boolean", short: "y" }, json: { type: "boolean" },
  });
  if (values.help) {
    console.log(MANIFEST_USAGE);
    return 0;
  }
  const from = values.from ?? "mods";
  if (from !== "mods" && from !== "releases") throw new UsageError("--from must be mods or releases");
  const cwd = userCwd();
  const e = defaultLocationEnv(cwd);
  const json = !!values.json;
  const file = values.manifest ? path.resolve(cwd, values.manifest) : findConfig(cwd)?.file ?? defaultManifestFile(cwd);

  let dir: string | undefined;
  let label: string | undefined;
  if (from === "mods") {
    const found = resolveModsDir({ flag: values["data-dir"] ?? values["mods-dir"], mode: "read" }, e);
    dir = found.path;
    label = found.label;
    if (!dir) throw new CliError(`no Mods folder found (looked at ${found.candidates.map((c) => c.path).join(", ")}); pass -p <VintagestoryData or Mods folder>`, 2);
  } else {
    const found = resolveProjectDir("releasesDir", values["releases-dir"], e);
    dir = found.path!;
    label = found.label;
  }
  if (!existsSync(dir)) throw new CliError(`no ${from === "mods" ? "Mods" : "Releases"} folder at ${dir}`, 2);

  const { pins, skipped } = from === "mods" ? pinsFromModsFolder(dir) : pinsFromReleases(dir);
  const existing = readManifestMods(file);
  const { mods, changes } = mergePins(existing, pins, !!values.prune);
  const changed = changes.filter((c) => c.action !== "same");
  if (json) {
    console.log(JSON.stringify({ manifest: file, from, folder: dir, changes, skipped, written: false }, null, 2));
  } else {
    console.log(`${dim("Reading")} ${cyan(dir)} ${dim(`(${label})`)}${dim(" -> ")}${cyan(file)}${existsSync(file) ? "" : dim(" (new)")}`);
    for (const c of changes) {
      if (c.action === "same") continue;
      const detail = c.action === "update" ? `${c.from ?? "unpinned"} -> ${c.to}` : c.action === "add" ? c.to : `was ${c.from ?? "unpinned"}`;
      console.log(`${MARK[c.action](SIGN[c.action])} ${bold(c.modid.padEnd(30))} ${MARK[c.action](detail ?? "")}`);
    }
    for (const s of skipped) console.log(yellow(`    ! skipped ${s.name}: ${s.reason}`));
    const same = changes.length - changed.length;
    console.log(`${changed.length ? "" : green("The manifest already matches. ")}${dim(`${changed.length} change(s), ${same} already as listed, ${skipped.length} skipped`)}`);
  }
  if (!changed.length) return 0;
  if (values["dry-run"]) {
    if (!json) console.log(dim("Dry run: nothing written."));
    return 0;
  }
  if (!(await confirm(`Update ${path.relative(cwd, file) || file}?`, !!values.yes))) {
    console.log(dim("No changes made."));
    return 1;
  }
  writeManifestMods(file, mods);
  if (!json) console.log(green(`✔ Wrote ${mods.length} mod(s) to ${file}`));
  return 0;
}

export async function runManifest(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(MANIFEST_USAGE);
    return command ? 0 : 2;
  }
  if (command === "freeze") return freeze(rest);
  if (command === "install") return runDownload(["--mods-only", ...rest]);
  throw new UsageError(`unknown manifest command '${command}' (freeze or install)`);
}
