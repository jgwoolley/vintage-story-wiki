// `vsdev find <text>`: asset codes of the game's (and this mod's) textures and shapes, by a piece of their name. A shape spec names
// textures as `game:block/wood/planks/oak1`, and the quickest way to a good model is a vanilla one to copy from; guessing either
// from memory is how specs end up with textures that don't exist.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseCommand } from "../args.js";
import { UsageError } from "../errors.js";
import { defaultLocationEnv, gameInfo, resolveGameDir } from "../locations.js";
import { cyan, dim, yellow } from "../moddb/ansi.js";
import { userCwd } from "../paths.js";

export const FIND_USAGE = `Usage: vsdev find <text>... [--textures | --shapes] [--limit 40] [--json] [--game-dir <dir>]

Lists the textures and shapes whose path contains every word given ("*" matches anything), from the game install and from this
folder's own assets/ tree, as the codes a shape or blocktype uses.

  vsdev find planks oak --textures     game:block/wood/planks/oak1 ...: what to put in a shape's "textures"
  vsdev find chest --shapes            survival shapes to read, render (vsdev render <file>) and copy from
  vsdev find "block/metal/*iron"

Options:
  --textures      only textures (assets/<domain>/textures/**.png). They are in the game client only, not the server download.
  --shapes        only shapes (assets/<domain>/shapes/**.json)
  --limit <n>     how many results (default 40, up to 1000); the total is always printed
  --game-dir <d>  the game install to look in (default: as vsdev render finds it; \`vsdev paths\` shows which)
  --json          machine-readable results: { kind, code, file }`;

export interface FoundAsset {
  kind: "texture" | "shape";
  /** What a shape's "textures" or a blocktype's "shape": { "base": ... } says: <domain>:<path without the folder and extension>. */
  code: string;
  file: string;
}

const KINDS = { texture: ["textures", ".png"], shape: ["shapes", ".json"] } as const;

/** Every texture and shape under `<root>/assets/<domain>/`, sorted by code. */
export function listAssets(root: string, kinds: ("texture" | "shape")[]): FoundAsset[] {
  const assets = path.join(root, "assets");
  const out: FoundAsset[] = [];
  if (!existsSync(assets)) return out;
  for (const domain of readdirSync(assets, { withFileTypes: true })) {
    if (!domain.isDirectory()) continue;
    for (const kind of kinds) {
      const [folder, ext] = KINDS[kind];
      const base = path.join(assets, domain.name, folder);
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base, { withFileTypes: true, recursive: true })) {
        if (!entry.isFile() || !entry.name.endsWith(ext)) continue;
        const file = path.join(entry.parentPath, entry.name);
        const code = path.relative(base, file).slice(0, -ext.length).split(path.sep).join("/");
        // The base game's three domains are all read as "game:" (as the game itself resolves them).
        out.push({ kind, code: `${["survival", "creative", "game"].includes(domain.name) ? "game" : domain.name}:${code}`, file });
      }
    }
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/** The assets whose code contains every word (case-insensitive; "*" in a word matches anything). Shorter codes first. */
export function matchAssets(assets: FoundAsset[], words: string[]): FoundAsset[] {
  const tests = words.map((w) => new RegExp(w.toLowerCase().split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")));
  return assets.filter((a) => tests.every((t) => t.test(a.code.toLowerCase()))).sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
}

export async function runFind(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, {
    textures: { type: "boolean" }, shapes: { type: "boolean" }, limit: { type: "string" }, json: { type: "boolean" }, "game-dir": { type: "string" },
  });
  if (values.help) {
    console.log(FIND_USAGE);
    return 0;
  }
  if (!positionals.length) throw new UsageError("find needs some text to look for");
  if (values.textures && values.shapes) throw new UsageError("--textures and --shapes each narrow the search to one kind; leave both out for both");
  const limit = Number(values.limit ?? 40);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new UsageError("--limit must be a whole number from 1 to 1000");
  const kinds: ("texture" | "shape")[] = values.textures ? ["texture"] : values.shapes ? ["shape"] : ["texture", "shape"];
  const cwd = userCwd();
  const game = resolveGameDir({ mode: "read", flag: values["game-dir"] }, defaultLocationEnv(cwd));
  const roots = [...new Set([cwd, ...(game.path ? [game.path] : [])])];
  const all = roots.flatMap((root) => listAssets(root, kinds));
  const found = matchAssets(all, positionals.flatMap((p) => p.split(/\s+/)).filter(Boolean));
  const rel = (f: string) => (path.relative(cwd, f).startsWith("..") ? f : path.relative(cwd, f));
  const notes: string[] = [];
  const info = game.path ? gameInfo(game.path) : undefined;
  if (game.path && !info) notes.push(`${game.path} is not a game install (vsdev paths shows where one is looked for): only what is under its assets/ and this folder's was searched`);
  else if (!game.path) notes.push("no game install found (vsdev paths shows where it is looked for; --game-dir or $VINTAGE_STORY sets it): only this folder's assets/ was searched");
  else if (kinds.includes("texture") && info?.kind !== "client") notes.push(`${game.path} is a server install, which has no textures: point --game-dir or $VINTAGE_STORY at the game client for those`);
  if (values.json) {
    console.log(JSON.stringify({ total: found.length, results: found.slice(0, limit).map((a) => ({ ...a, file: rel(a.file) })), notes }, null, 2));
    return 0;
  }
  const width = Math.min(60, Math.max(0, ...found.slice(0, limit).map((a) => a.code.length)));
  for (const a of found.slice(0, limit)) console.log(`${dim(a.kind.padEnd(8))}${cyan(a.code.padEnd(width))}  ${dim(rel(a.file))}`);
  if (!found.length) console.log(`nothing matches ${positionals.join(" ")} (${all.length} ${kinds.join("s and ")}s looked at)`);
  else if (found.length > limit) console.log(dim(`... and ${found.length - limit} more (--limit ${Math.min(1000, found.length)}, or add a word)`));
  for (const n of notes) console.log(yellow(n));
  return 0;
}
