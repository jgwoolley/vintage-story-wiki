// `vsdev download`: the game and the pinned mods named in a vs-manifest.json (this repo's own, or a mod project's).
import path from "node:path";
import { parseCommand } from "../args.js";
import { CliError, UsageError } from "../errors.js";
import { CLIENT_NOT_DOWNLOADED, installServer, type GameKind } from "../game/download.js";
import { installManifestMod, readManifest } from "../download/manifest.js";
import { CONFIG_FILE, defaultLocationEnv, findConfig, resolveGameDir, resolveModsDir } from "../locations.js";
import { ModDb } from "../mods/moddb.js";
import { userCwd } from "../paths.js";

export const DOWNLOAD_USAGE = `Usage: vsdev download [options]

Installs the dedicated server and every mod listed in a manifest (default: the nearest ${CONFIG_FILE} in this folder or a parent):
  { "serverBranch": "stable", "serverVersion": "1.22.7", "mods": [{ "modid": "betterruins", "version": "0.6.4" }] }
A mod without a version gets ModDB's pick for that game version. Dependencies are not followed (pin them, or use vsdev mod install).

The game goes where \`vsdev game\` puts it (--game-dir, $VINTAGE_STORY, gameDir, else ./vintagestory) and the mods where
\`vsdev mod install\` does (--data-dir, $VINTAGE_STORY_DATA, dataDir, else ./Mods). \`vsdev paths\` shows both.

Options:
  --manifest <file>    the manifest
  --server             download the dedicated server (the default; with "gameKind": "client" or --client only the mods are
                       downloaded: the client is the paid game, installed from your account)
  --game-dir <dir>     where the game goes (--server-dir is the same)
  -p, --data-dir <dir> where the mods go: a data folder (its Mods/) or a Mods folder (--mods-dir is the same)
  --force              re-download what is already present`;

export async function runDownload(argv: string[]): Promise<number> {
  const { values } = parseCommand(argv, {
    manifest: { type: "string" },
    client: { type: "boolean" },
    server: { type: "boolean" },
    "game-dir": { type: "string" },
    "server-dir": { type: "string" },
    "data-dir": { type: "string", short: "p" },
    "mods-dir": { type: "string" },
    force: { type: "boolean" },
  });
  if (values.help) {
    console.log(DOWNLOAD_USAGE);
    return 0;
  }
  if (values.client && values.server) throw new UsageError("pick one of --client and --server");
  const cwd = userCwd();
  const manifestFile = values.manifest ? path.resolve(cwd, values.manifest) : findConfig(cwd)?.file;
  if (!manifestFile) throw new CliError(`no ${CONFIG_FILE} here or in a parent folder; pass --manifest <file>`, 2);
  let manifest;
  try {
    manifest = readManifest(manifestFile);
  } catch (err) {
    throw new CliError(`${manifestFile}: ${(err as Error).message}`, 2);
  }
  // Resolve relative to the manifest's own folder, like every other path in it.
  const e = { ...defaultLocationEnv(cwd), config: findConfig(path.dirname(manifestFile)) ?? null };
  const kind: GameKind = values.server ? "server" : values.client ? "client" : e.config?.gameKind ?? "server";
  const game = resolveGameDir({ flag: values["game-dir"] ?? values["server-dir"], mode: "write" }, e);
  const mods = resolveModsDir({ flag: values["data-dir"] ?? values["mods-dir"], mode: "write" }, e);
  console.log(`Game: ${game.path} (${game.label}); mods: ${mods.path} (${mods.label})`);
  if (kind === "client") {
    // The client is never downloaded (src/game/download.ts); its mods still can be.
    console.log(`(game: not downloading the client)\n${CLIENT_NOT_DOWNLOADED}\n`);
  } else {
    await installServer({ branch: manifest.serverBranch, version: manifest.serverVersion, force: !!values.force, dir: game.path! });
  }
  const db = new ModDb();
  let failed = 0;
  for (const spec of manifest.mods) {
    try {
      const result = await installManifestMod(spec, { db, modsDir: mods.path!, force: !!values.force, gameVersion: manifest.serverVersion });
      if (result.error) {
        console.error(`✘ ${result.error}`);
        failed++;
      }
    } catch (err) {
      console.error(`✘ ${spec}: ${(err as Error).message}`);
      failed++;
    }
  }
  console.log(failed ? `✘ ${failed} mod(s) failed` : "✔ Done");
  return failed ? 1 : 0;
}
