// Checks the built site (`_site/`): every internal link must point at a page or file that exists, and every
// `?q=` search link into a listing must match at least one of that listing's rows (the datatable's own matching rules:
// substring on the row's text + data-search, `a or b` = either, `*` = glob). Prints the broken ones grouped by cause and
// exits 1 if there are any. Run after `npm run build`: `npm run check-links`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

const SITE = "_site";
const PREFIX = (process.env.PATH_PREFIX ?? "/").replace(/\/?$/, "/");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".html")) out.push(full);
  }
  return out;
}

const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").toLowerCase();

/** Lowercased text of each datatable row of a page (visible text plus data-search), cached per page. */
const rowCache = new Map<string, string[]>();
function rowsOf(file: string): string[] {
  let rows = rowCache.get(file);
  if (!rows) {
    const html = readFileSync(file, "utf8");
    rows = [...html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)]
      .map((m) => `${stripTags(m[2])} ${decodeEntities(/data-search="([^"]*)"/.exec(m[1])?.[1] ?? "").toLowerCase()}`);
    rowCache.set(file, rows);
  }
  return rows;
}

function rowMatches(row: string, query: string): boolean {
  if (/\s+or\s+/.test(query)) return query.split(/\s+or\s+/).some((t) => t && rowMatches(row, t.trim()));
  if (query.includes("*")) return new RegExp(query.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")).test(row);
  return row.includes(query);
}

function resolveFile(urlPath: string): string | undefined {
  const rel = decodeURIComponent(urlPath.startsWith(PREFIX) ? urlPath.slice(PREFIX.length) : urlPath.replace(/^\//, ""));
  for (const candidate of [join(SITE, rel), join(SITE, rel, "index.html")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

const broken = new Map<string, Set<string>>(); // problem -> pages it occurs on
const note = (problem: string, page: string) => broken.set(problem, (broken.get(problem) ?? new Set()).add(page));
const seen = new Set<string>();

for (const file of walk(SITE)) {
  const page = "/" + file.slice(SITE.length + 1).replace(/index\.html$/, "");
  const html = readFileSync(file, "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  for (const m of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
    const raw = decodeEntities(m[1]);
    if (!raw || /^(https?:|mailto:|tel:|data:|javascript:|#)/.test(raw)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      note(`unrewritten scheme: ${raw.slice(0, 80)}`, page); // e.g. a game handbook:// link that was never turned into a page link
      continue;
    }
    if (raw.includes("{{") || raw.includes("undefined")) {
      note(`link contains a template leftover or "undefined": ${raw}`, page);
      continue;
    }
    const url = new URL(raw, `http://x${page}`);
    const key = `${url.pathname}?${url.search}`;
    if (seen.has(key + page)) continue;
    seen.add(key + page);
    const target = resolveFile(url.pathname);
    if (!target) {
      note(`missing page/file: ${url.pathname}`, page);
      continue;
    }
    const q = url.searchParams.get("q");
    if (q && target.endsWith(".html")) {
      const query = q.trim().toLowerCase();
      if (query && !rowsOf(target).some((row) => rowMatches(row, query))) note(`search matches nothing: ${url.pathname}?q=${q}`, page);
    }
  }
}

if (!broken.size) {
  console.log("No broken links.");
} else {
  for (const [problem, pages] of [...broken].sort()) console.log(`${problem}\n    on ${[...pages].slice(0, 3).join(", ")}${pages.size > 3 ? ` (+${pages.size - 3} more)` : ""}`);
  console.log(`\n${broken.size} distinct broken links.`);
  process.exit(1);
}
