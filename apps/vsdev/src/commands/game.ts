// `vsdev game`: download the Vintage Story dedicated server into the game install location (see src/locations.ts). The client is
// deliberately not downloaded (see src/game/download.ts); `--client` explains where it comes from.
import { intro, log, outro, spinner } from "@clack/prompts";
import path from "node:path";
import { parseCommand } from "../args.js";
import { UsageError } from "../errors.js";
import { CLIENT_NOT_DOWNLOADED, installServer, type GameKind } from "../game/download.js";
import { defaultLocationEnv, findConfig, resolveGameDir, type LocationEnv } from "../locations.js";
import { latestStableGameVersion, ModDb } from "../mods/moddb.js";
import { bold, cyan, dim } from "../moddb/ansi.js";
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
  --client             download the game client instead (the paid game: needs --accept-client-terms, else it says where it comes from)
  --accept-client-terms  you checked the Terms of Service / the Vintage Story developers and may download the client for your use
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
  /** --accept-client-terms: the user's statement that downloading the client is fine for their use. */
  acceptClientTerms: boolean;
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
    "accept-client-terms": { type: "boolean" },
  });
  if (values.help) return "help";
  if (values.client && values.server) throw new UsageError("pick one of --client and --server");
  const config = e.config === undefined ? findConfig(e.cwd) : e.config ?? undefined;
  // --client (or "gameKind": "client") downloads the client only together with --accept-client-terms; otherwise it explains where it comes from.
  const kind: GameKind = values.server ? "server" : values.client ? "client" : config?.gameKind ?? "server";
  const branch = values.branch ?? config?.serverBranch ?? "stable";
  if (!["stable", "unstable"].includes(branch)) throw new UsageError("--branch must be stable or unstable");
  const target = resolveGameDir({ flag: values["game-dir"] ?? values.dir, mode: "write" }, e);
  const version = values.version ?? e.env.VINTAGE_STORY_VERSION ?? config?.gameVersion;
  return { kind, branch, version: version?.replace(/^v/i, ""), dir: target.path!, dirFrom: target.label!, force: !!values.force, acceptClientTerms: !!values["accept-client-terms"] };
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
  if (options.kind === "client" && !options.acceptClientTerms) {
    console.log(CLIENT_NOT_DOWNLOADED);
    return 2;
  }
  const version = options.version ?? (await newestVersion());
  intro(`${bold("vsdev game")} ${dim(`${options.kind} ${version}`)}`);
  log.info(`Target: ${cyan(options.dir)} ${dim(`(from ${options.dirFrom})`)}`);
  const tty = !!process.stderr.isTTY;
  const spin = tty ? spinner() : undefined;
  spin?.start("Downloading");
  let last = 0;
  const mb = (n: number) => (n / 1048576).toFixed(0);
  let action: Awaited<ReturnType<typeof installServer>>;
  try {
    action = await installServer({
      ...options,
      version,
      log: (msg) => (/^(==>|✔)/.test(msg) ? spin?.message(msg.replace(/^(==>|✔)\s*/, "")) : log.info(msg.replace(/^- /, ""))),
      onProgress: (done, total) => {
        if (!spin || Date.now() - last < 200) return;
        last = Date.now();
        spin.message(`Downloading ${mb(done)}${total ? ` / ${mb(total)} MB (${Math.floor((done / total) * 100)}%)` : " MB"}`);
      },
    });
  } catch (err) {
    spin?.error("Download failed");
    throw err;
  }
  spin?.stop(action === "downloaded" ? "Downloaded" : "Done");
  if (options.dirFrom.startsWith("./") || action === "downloaded") {
    log.message(`To point vsdev at it (it has no textures; for a mod project's builds point VINTAGE_STORY at your installed game instead):\n${cyan(`export VINTAGE_STORY="${path.resolve(options.dir)}"`)}`);
  }
  outro("Done");
  return 0;
}
