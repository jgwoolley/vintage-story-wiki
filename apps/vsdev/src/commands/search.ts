// `vsdev search <text>`: look things up in the Nf3t wiki (items, creatures, structures, guides...) without leaving the terminal.
import { parseCommand, table } from "../args.js";
import { CliError, UsageError } from "../errors.js";
import { defaultLocationEnv, resolveWikiUrl } from "../locations.js";
import { bold, cyan, dim, yellow } from "../moddb/ansi.js";
import { userCwd } from "../paths.js";
import { fetchWikiIndex, kindsOf, searchWiki } from "../wiki/search.js";

export const SEARCH_USAGE = `Usage: vsdev search <text>... [--kind Item] [--limit 10] [--json] [--wiki <url>]

Searches the wiki's pages (items, creatures, structures, clutter, paintings, clothing, classes, guides, books, lore, traders) the way
its header search box does: titles that start with the text first, then titles that contain it, then codes. Prints the page address.

Options:
  --kind <kind>   only one kind of page (Item, Block, Creature, Structure, Guide, ...; case-insensitive)
  --limit <n>     how many results (default 10, up to 200)
  --lang <code>   the wiki's language folder (default: en)
  --wiki <url>    the wiki to ask. Otherwise $VSDEV_WIKI_URL, then "prodWikiUrl" in the nearest vs-manifest.json, then the project's own wiki
                  (\`vsdev paths\` shows which)
  --json          machine-readable results`;

export async function runSearch(argv: string[], fetchImpl: typeof fetch = fetch): Promise<number> {
  const { values, positionals } = parseCommand(argv, {
    kind: { type: "string" }, limit: { type: "string" }, lang: { type: "string" }, wiki: { type: "string" }, json: { type: "boolean" },
  });
  if (values.help) {
    console.log(SEARCH_USAGE);
    return 0;
  }
  if (!positionals.length) throw new UsageError("search needs some text to look for");
  const limit = Number(values.limit ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new UsageError("--limit must be a whole number from 1 to 200");
  const wiki = resolveWikiUrl(values.wiki, defaultLocationEnv(userCwd()));
  let rows;
  try {
    rows = await fetchWikiIndex(wiki.path!, fetchImpl);
  } catch (err) {
    throw new CliError((err as Error).message);
  }
  if (values.kind && !rows.some((r) => r.kind.toLowerCase() === values.kind!.toLowerCase())) {
    throw new UsageError(`no such kind '${values.kind}' (the wiki has: ${kindsOf(rows).join(", ")})`);
  }
  const hits = searchWiki(rows, positionals.join(" "), wiki.path!, { kind: values.kind, limit, lang: values.lang });
  if (values.json) {
    console.log(JSON.stringify({ wiki: wiki.path, query: positionals.join(" "), results: hits.map(({ rank: _r, ...h }) => h) }, null, 2));
    return hits.length ? 0 : 1;
  }
  if (!hits.length) {
    console.log(yellow(`No pages match '${positionals.join(" ")}'.`) + dim(` (${rows.length} pages searched at ${wiki.path})`));
    return 1;
  }
  console.log(table([["TITLE", "KIND", "CODE", "PAGE"], ...hits.map((h) => [h.title, h.kind, h.code, h.url])],
    (row, col, cell) => (row === 0 ? bold(cell) : col === 0 ? bold(cell) : col === 1 ? cyan(cell) : col === 2 ? dim(cell) : cell)));
  return 0;
}
