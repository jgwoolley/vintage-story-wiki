// The vsdev command dispatcher (src/cli.ts runs it; tests call main directly).
import { runDownload } from "./commands/download.js";
import { runGame } from "./commands/game.js";
import { runMod } from "./commands/mod.js";
import { runModdb } from "./commands/moddb.js";
import { runPaths } from "./commands/paths.js";
import { CliError, UsageError } from "./errors.js";
import { GameDownloadError } from "./game/download.js";
import { ModDbError } from "./mods/moddb.js";
import { runRender, USAGE as RENDER_USAGE } from "./render/cli.js";

export const USAGE = `Usage: vsdev <command> [options]       (vsdev <command> --help for its options)

  render <file>...     render models (with animations), schematics and ChiselTools .pf shapes to PNGs, headless
  game                 download the dedicated server (the game client is never downloaded: --client says why)
  mod <command>        other people's mods: search, info, install (with dependencies), update, extract
  moddb <command>      your mods' ModDB pages: check, status, scaffold, pull, diff, serve (a local review page), export (a static site)
  download             the dedicated server and pinned mods from a vs-manifest.json
  paths                where every location resolves (flag, env, vs-manifest.json, this folder, the real install)`;

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  render: async (argv) => (await runRender(argv), 0),
  game: runGame,
  mod: runMod,
  moddb: runModdb,
  download: runDownload,
  paths: runPaths,
};

const USAGES: Record<string, string> = { render: RENDER_USAGE };

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  try {
    if (!run) throw new UsageError(`unknown command '${command}'`);
    return await run(rest);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}\n\n${USAGES[command] ?? (run ? `(vsdev ${command} --help for its options)` : USAGE)}`);
      return 2;
    }
    if (err instanceof CliError || err instanceof ModDbError || err instanceof GameDownloadError) {
      console.error(`error: ${err.message}`);
      return err instanceof CliError ? err.exitCode : 1;
    }
    // Not one of ours: a bug or an unexpected failure. Keep the stack when asked.
    console.error(process.env.VSDEV_DEBUG ? err : `error: ${(err as Error).message ?? err} (VSDEV_DEBUG=1 shows the stack)`);
    return 1;
  }
}
