// The vsdev command dispatcher (src/cli.ts runs it; tests call main directly).
import pc from "picocolors";
import { runDownload } from "./commands/download.js";
import { runGame } from "./commands/game.js";
import { runMod } from "./commands/mod.js";
import { runManifest } from "./commands/manifest.js";
import { runModdb } from "./commands/moddb.js";
import { runPaths } from "./commands/paths.js";
import { runScreenshots, SCREENSHOTS_USAGE } from "./commands/screenshots.js";
import { runSearch } from "./commands/search.js";
import { CliError, UsageError } from "./errors.js";
import { redError } from "./moddb/ansi.js";
import { GameDownloadError } from "./game/download.js";
import { ModDbError } from "./mods/moddb.js";
import { runRender, USAGE as RENDER_USAGE } from "./render/cli.js";

const ROWS: [string, string][] = [
  ["render <file>...", "render models (with animations), schematics and ChiselTools .pf shapes to PNGs, headless"],
  ["screenshots [name...]", "render the schematic screenshots listed in vs-manifest.json (angles, sizes) to PNGs, e.g. for a ModDB page"],
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
${ROWS.map(([name, text]) => `  ${pc.cyan(name.padEnd(18))} ${text}`).join("\n")}`;

export const USAGE = usage();

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  render: async (argv) => (await runRender(argv), 0),
  game: runGame,
  mod: runMod,
  moddb: runModdb,
  screenshots: (argv) => runScreenshots(argv),
  search: (argv) => runSearch(argv),
  manifest: runManifest,
  download: runDownload,
  paths: runPaths,
};

const USAGES: Record<string, string> = { render: RENDER_USAGE, screenshots: SCREENSHOTS_USAGE };

const errorLabel = () => `${redError("error:")}`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(usage());
    return command ? 0 : 2;
  }
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  try {
    if (!run) throw new UsageError(`unknown command '${command}'`);
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
