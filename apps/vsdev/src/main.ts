// The vsdev command dispatcher (src/cli.ts runs it; tests call main directly).
import pc from "picocolors";
import { runDownload } from "./commands/download.js";
import { runGame } from "./commands/game.js";
import { runMod } from "./commands/mod.js";
import { runManifest } from "./commands/manifest.js";
import { runModdb } from "./commands/moddb.js";
import { runPaths } from "./commands/paths.js";
import { runScreenshots, SCREENSHOTS_USAGE } from "./commands/screenshots.js";
import { FIND_USAGE, runFind } from "./commands/find.js";
import { runSearch } from "./commands/search.js";
import { runShape, SHAPE_USAGE } from "./commands/shape.js";
import { runTexture, TEXTURE_USAGE } from "./commands/texture.js";
import { CliError, UsageError } from "./errors.js";
import { redError } from "./moddb/ansi.js";
import { GameDownloadError } from "./game/download.js";
import { ModDbError } from "./mods/moddb.js";
import { userCwd } from "./paths.js";
import { runRender, USAGE as RENDER_USAGE } from "./render/cli.js";
import { NO_SCHEMA_UPDATE, SCHEMA_FILE, updateManifestSchema } from "./schemaUpdate.js";

const ROWS: [string, string][] = [
  ["render <file>...", "render models (with animations), schematics and ChiselTools .pf shapes to PNGs, headless; --check lints a model"],
  ["screenshots [name...]", "render the schematic screenshots listed in vs-manifest.json (angles, sizes) to PNGs, e.g. for a ModDB page"],
  ["texture <spec>...", "paint PNG textures from layers (noise, grain, wear, bevels, bricks, pixel art), seeded and tiling"],
  ["shape <spec>...", "build shape (model) JSON from boxes placed on each other, joints, corners, mirrors, reliefs; checked; --render to look"],
  ["find <text>...", "asset codes of the game's textures and shapes by name: what to put in a shape's textures, vanilla shapes to copy"],
  ["game", "download the dedicated server (the game client is never downloaded: --client says why)"],
  ["mod <command>", "other people's mods: search, info, install (with dependencies), update, extract"],
  ["moddb <command>", "your mods' ModDB pages: check, status, scaffold, pull, diff, serve (a local review page), export (a static site)"],
  ["search <text>...", "search the wiki (items, creatures, structures, guides...) from the terminal"],
  ["manifest <command>", "vs-manifest.json as a requirements file: freeze (folder -> manifest), install (manifest -> folder)"],
  ["download", "the dedicated server and pinned mods from a vs-manifest.json"],
  ["paths", "where every location resolves (flag, env, vs-manifest.json, this folder, the real install)"],
];

/** The top-level help; colored only on a terminal (picocolors), so piped output and tests see plain text. */
export const usage = (): string => `${pc.bold("vsdev")} ${pc.dim("-")} Vintage Story dev tools on the command line

${pc.bold("Usage")}  vsdev ${pc.cyan("<command>")} [options]   ${pc.dim("(vsdev <command> --help for its options)")}

${pc.bold("Commands")}
${ROWS.map(([name, text]) => `  ${pc.cyan(name.padEnd(18))} ${text}`).join("\n")}

${pc.bold("Every command")}
  A ${SCHEMA_FILE} in the folder you run vsdev from is refreshed to the copy this vsdev ships
  (editors read it for vs-manifest.json). ${pc.cyan(NO_SCHEMA_UPDATE)} (anywhere on the command line) leaves it alone.`;

export const USAGE = usage();

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  render: runRender,
  game: runGame,
  mod: runMod,
  moddb: runModdb,
  screenshots: (argv) => runScreenshots(argv),
  search: (argv) => runSearch(argv),
  find: runFind,
  texture: runTexture,
  shape: runShape,
  manifest: runManifest,
  download: runDownload,
  paths: runPaths,
};

const USAGES: Record<string, string> = { render: RENDER_USAGE, screenshots: SCREENSHOTS_USAGE, texture: TEXTURE_USAGE, shape: SHAPE_USAGE, find: FIND_USAGE };

const errorLabel = () => `${redError("error:")}`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const rest = args.filter((a) => a !== NO_SCHEMA_UPDATE);
  const refreshSchema = rest.length === args.length;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(usage());
    return command ? 0 : 2;
  }
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  try {
    if (!run) throw new UsageError(`unknown command '${command}'`);
    if (refreshSchema && !rest.includes("--help") && !rest.includes("-h")) refreshManifestSchema();
    return await run(rest);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`${errorLabel()} ${err.message}\n\n${USAGES[command] ?? (run ? pc.dim(`(vsdev ${command} --help for its options)`) : usage())}`);
      return 2;
    }
    if (err instanceof CliError || err instanceof ModDbError || err instanceof GameDownloadError) {
      console.error(`${errorLabel()} ${err.message}`);
      return err instanceof CliError ? err.exitCode : 1;
    }
    // Not one of ours: a bug or an unexpected failure. Keep the stack when asked.
    console.error(process.env.VSDEV_DEBUG ? err : `${errorLabel()} ${(err as Error).message ?? err} ${pc.dim("(VSDEV_DEBUG=1 shows the stack)")}`);
    return 1;
  }
}

/** Brings the working folder's vs-manifest.schema.json up to date (see schemaUpdate.ts); a failure is a warning, never a failed command. */
function refreshManifestSchema(): void {
  try {
    if (updateManifestSchema(userCwd()) === "updated") console.error(pc.dim(`vsdev: updated ${SCHEMA_FILE} to the copy this vsdev ships (${NO_SCHEMA_UPDATE} to leave it)`));
  } catch (err) {
    console.error(pc.dim(`vsdev: couldn't update ${SCHEMA_FILE}: ${(err as Error).message} (${NO_SCHEMA_UPDATE} to skip)`));
  }
}
