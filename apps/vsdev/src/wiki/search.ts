// `vsdev search`: the wiki's own header search, from the terminal. The site publishes its index at <wiki>/assets/searchIndex.json as
// [title, path under /<lang>/, kind, code] rows (apps/vs-wiki/site/assets/searchIndex.json.njk); the ranking is the one in wikiSearch.js
// (title starts with the query, then a word of the title, then the title, then the code), so the terminal and the page agree.
// Several words must all appear (in the title or the code) when the whole phrase doesn't.

export interface WikiRow {
  title: string;
  path: string;
  kind: string;
  code: string;
}

export interface WikiHit extends WikiRow {
  url: string;
  /** 0 best. */
  rank: number;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Fetches and parses the wiki's search index. */
export async function fetchWikiIndex(base: string, fetchImpl: Fetch = fetch): Promise<WikiRow[]> {
  const url = new URL("assets/searchIndex.json", base).toString();
  const res = await fetchImpl(url, { headers: { "User-Agent": "vsdev" }, signal: AbortSignal.timeout(60_000) }).catch((err: Error) => {
    throw new Error(`${url}: ${err.message}`);
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}${res.status === 404 ? " (is this the wiki's address? see vs-manifest.json prodWikiUrl)" : ""}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error(`${url}: not a search index`);
  return data.flatMap((r) => (Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "string" ? [{ title: r[0], path: r[1], kind: String(r[2] ?? ""), code: String(r[3] ?? "") }] : []));
}

function rank(title: string, code: string, q: string, words: string[]): number {
  const t = title.toLowerCase();
  const c = code.toLowerCase();
  if (t.startsWith(q)) return 0;
  if (t.includes(` ${q}`) || t.includes(`-${q}`)) return 1;
  if (t.includes(q)) return 2;
  if (c.includes(q)) return 3;
  if (words.length > 1 && words.every((w) => t.includes(w) || c.includes(w))) return 4;
  return -1;
}

export interface SearchOptions {
  /** Only this kind (case-insensitive: Item, Creature, Structure...). */
  kind?: string;
  limit?: number;
  /** The /<lang>/ the pages are under. */
  lang?: string;
}

/** The best matches, best first (then shorter titles, then alphabetical, like the page). */
export function searchWiki(rows: WikiRow[], query: string, base: string, { kind, limit = 10, lang = "en" }: SearchOptions = {}): WikiHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const want = kind?.toLowerCase();
  const hits: WikiHit[] = [];
  for (const row of rows) {
    if (want && row.kind.toLowerCase() !== want) continue;
    const r = rank(row.title, row.code, q, words);
    if (r >= 0) hits.push({ ...row, rank: r, url: new URL(`${lang}/${row.path}`, base).toString() });
  }
  hits.sort((a, b) => a.rank - b.rank || a.title.length - b.title.length || a.title.localeCompare(b.title));
  return hits.slice(0, limit);
}

/** The distinct kinds in an index, for the "no such kind" message. */
export const kindsOf = (rows: WikiRow[]): string[] => [...new Set(rows.map((r) => r.kind))].sort();
