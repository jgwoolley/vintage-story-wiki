// `vsdev game`: download the Vintage Story dedicated server into the game install location (see src/locations.ts). The client is
// deliberately not downloaded (see src/game/download.ts); `--client` explains where it comes from.
import path from "node:path";
import { parseCommand } from "../args.js";
import { UsageError } from "../errors.js";
import { CLIENT_NOT_DOWNLOADED, installServer, type GameKind } from "../game/download.js";
import { defaultLocationEnv, findConfig, resolveGameDir, type LocationEnv } from "../locations.js";
import { latestStableGameVersion, ModDb } from "../mods/moddb.js";
import { userCwd } from "../paths.js";

export const GAME_USAGE = `Usage: vsdev game [--server] [options]

Downloads the Vintage Story dedicated server (Linux x64) from the game's CDN and unpacks it: the game's data (assets) and the DLLs, but
not the textures. It goes to (first that is set): --game-dir, $VINTAGE_STORY, gameDir in vs-manifest.json, else ./vintagestory (an old
./vs_server is used if it's the only one). It never defaults into a real install; \`vsdev paths\` shows what each location resolves to.

The game client (the whole game, with textures) isn't downloaded: it's the paid game, which you download from your account.
\`vsdev game --client\` explains where, and how to point vsdev at your install.

What happens to a folder that isn't empty:
  the same version (a server, or a client, which includes the server)   left alone
  a client of another version                                          refused (a server would lose the textures)
  a server vsdev installed (it leaves .vsdev-game.json)                replaced with the version asked for
  anything else (your own install, other files)                        left alone
--force always reinstalls. A replacement only happens after the new download has unpacked.

Options:
  --server             download the dedicated server (the default)
  --client             say where the game client comes from instead (it isn't downloaded)
  --version <v>        game version (default: $VINTAGE_STORY_VERSION, vs-manifest.json, else the newest stable on ModDB)
  --branch <b>         stable or unstable (default: vs-manifest.json serverBranch, else stable)
  --game-dir <dir>     where to install (--dir is the same)
  --force              reinstall even if the folder isn't empty`;

export interface GameArgs {
  kind: GameKind;
  branch: string;
  /** Undefined: ask ModDB for the newest stable version. */
  version?: string;
  dir: string;
  /** Where `dir` came from (--game-dir, $VINTAGE_STORY, vs-manifest.json gameDir, ./vintagestory...). */
  dirFrom: string;
  force: boolean;
}

export function parseGameArgs(argv: string[], e: LocationEnv = defaultLocationEnv(userCwd())): GameArgs | "help" {
  const { values } = parseCommand(argv, {
    client: { type: "boolean" },
    server: { type: "boolean" },
    version: { type: "string" },
    branch: { type: "string" },
    "game-dir": { type: "string" },
    dir: { type: "string" },
    force: { type: "boolean" },
  });
  if (values.help) return "help";
  if (values.client && values.server) throw new UsageError("pick one of --client and --server");
  const config = e.config === undefined ? findConfig(e.cwd) : e.config ?? undefined;
  // --client (or "gameKind": "client") only explains where the client comes from; it is never downloaded.
  const kind: GameKind = values.server ? "server" : values.client ? "client" : config?.gameKind ?? "server";
  const branch = values.branch ?? config?.serverBranch ?? "stable";
  if (!["stable", "unstable"].includes(branch)) throw new UsageError("--branch must be stable or unstable");
  const target = resolveGameDir({ flag: values["game-dir"] ?? values.dir, mode: "write" }, e);
  const version = values.version ?? e.env.VINTAGE_STORY_VERSION ?? config?.gameVersion;
  return { kind, branch, version: version?.replace(/^v/i, ""), dir: target.path!, dirFrom: target.label!, force: !!values.force };
}

/** The newest stable game version on ModDB, or 1.22.7 when ModDB can't be reached. */
async function newestVersion(): Promise<string> {
  try {
    return latestStableGameVersion((await new ModDb().gameVersions()).map((g) => g.name)) ?? "1.22.7";
  } catch {
    return "1.22.7";
  }
}

export async function runGame(argv: string[]): Promise<number> {
  const options = parseGameArgs(argv);
  if (options === "help") {
    console.log(GAME_USAGE);
    return 0;
  }
  if (options.kind === "client") {
    console.log(CLIENT_NOT_DOWNLOADED);
    return 2;
  }
  const version = options.version ?? (await newestVersion());
  console.log(`Target: ${options.dir} (from ${options.dirFrom})`);
  let last = 0;
  const tty = process.stderr.isTTY;
  const action = await installServer({
    ...options,
    version,
    onProgress: (done, total) => {
      if (!tty || Date.now() - last < 200) return;
      last = Date.now();
      const mb = (n: number) => (n / 1048576).toFixed(0);
      process.stderr.write(`\r   ${mb(done)}${total ? ` / ${mb(total)} MB (${Math.floor((done / total) * 100)}%)` : " MB"}   `);
    },
  }).finally(() => tty && process.stderr.write("\n"));
  if (options.dirFrom.startsWith("./") || action === "downloaded") {
    console.log(`To point vsdev at it (it has no textures; for a mod project's builds point VINTAGE_STORY at your installed game instead): export VINTAGE_STORY="${path.resolve(options.dir)}"`);
  }
  return 0;
}
