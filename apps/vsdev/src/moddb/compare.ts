// The live page against moddb/<modid>/: a port of ModDbCli's PageComparer.cs and UnifiedDiff.cs.
// - A file that differs, or exists only live, is "changed"; a local file whose live counterpart is gone is "removed", except a local-only
//   releases/* file, which is a release draft not uploaded yet ("pending", not a difference).
// - Images (logo, screenshots) are compared byte for byte with what the site serves.
// - TODO: placeholders and page.json schema problems are reported for every page, published or not.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildFiles, buildPage, imageUrls, PAGE_JSON, PLACEHOLDER, readLocal } from "./files.js";
import type { LiveClient, LiveMod } from "./live.js";
import type { PageValidator } from "./validate.js";

export type PageStatus = "same" | "changed" | "invalid" | "scaffolded" | "missing-scaffold" | "error";

export interface PageDiff {
  modId: string;
  status: PageStatus;
  /** Files that differ, or exist only live. */
  changed: string[];
  /** Local files whose live counterpart is gone. */
  removed: string[];
  /** Local release drafts not live yet (informational). */
  pending: string[];
  /** Unified diff of every difference (local = old, live = new). */
  diff: string;
  detail: string;
  warnings: string[];
  /** Placeholder (TODO:) files still to be written. */
  placeholders: string[];
  /** On the site and not a draft. */
  published: boolean;
}

export const newDiff = (modId: string): PageDiff => ({ modId, status: "same", changed: [], removed: [], pending: [], diff: "", detail: "", warnings: [], placeholders: [], published: false });

export async function comparePage(client: LiveClient, validator: PageValidator, modid: string, live: LiveMod | null, modDir: string): Promise<PageDiff> {
  const result = newDiff(modid);
  result.published = !!live && !live.isDraft;
  const local = readLocal(modDir);

  if (!live) result.status = existsSync(modDir) ? "scaffolded" : "missing-scaffold";
  else await compareLive(result, client, modid, live, modDir, local);

  for (const [name, text] of Object.entries(local)) if (name.endsWith(".html") && text.includes(PLACEHOLDER)) result.placeholders.push(name);
  if (result.placeholders.length) result.warnings.push(`placeholder text (${PLACEHOLDER}) not filled in: ${result.placeholders.join(", ")}`);

  const pageJson = local[PAGE_JSON];
  if (pageJson !== undefined) {
    const problems = validator.validate(pageJson);
    result.warnings.push(...problems.map((p) => `${PAGE_JSON}: ${p}`));
    if (problems.length && (result.status === "same" || result.status === "scaffolded")) result.status = "invalid";
    if (live && !live.isDraft && !problems.length && (JSON.parse(pageJson) as { moddbId?: unknown }).moddbId == null) {
      result.warnings.push("published since scaffolding (moddbId is null); run pull");
    }
  }
  return result;
}

async function compareLive(result: PageDiff, client: LiveClient, modid: string, live: LiveMod, modDir: string, local: Record<string, string>): Promise<void> {
  const files = buildFiles(modid, live);
  const page = buildPage(modid, live);
  if (page.logo == null) result.warnings.push(live.isDraft ? "draft page has no logo" : "live page has no logo");
  if (!(page.screenshots as string[]).length) result.warnings.push(live.isDraft ? "draft page has no screenshots" : "live page has no screenshots");

  let chunks = "";
  const names = [...new Set([...Object.keys(files), ...Object.keys(local)])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const liveText = files[name], localText = local[name];
    if (liveText !== undefined && localText !== undefined && liveText === localText) continue;
    if (liveText === undefined) {
      if (name.startsWith("releases/")) {
        result.pending.push(name);
        continue;
      }
      result.removed.push(name);
    } else {
      result.changed.push(name);
    }
    chunks += unifiedDiff(localText ?? "", liveText ?? "", `local/${modid}/${name}`, `live/${modid}/${name}`);
  }

  for (const [name, url] of Object.entries(imageUrls(live))) {
    const file = path.join(modDir, name);
    const exists = existsSync(file);
    const liveBytes = await client.bytes(url);
    if (!exists || !readFileSync(file).equals(liveBytes)) {
      result.changed.push(name);
      chunks += `Binary file ${name} ${exists ? "differs" : "is missing locally"}\n`;
    }
  }
  result.diff = chunks;
  if (result.changed.length || result.removed.length) result.status = "changed";
}

type Op = "=" | "-" | "+";

/** UnifiedDiff.Create: a line-based unified diff (LCS) with `context` lines around each change; "" when the texts are equal. */
export function unifiedDiff(oldText: string, newText: string, oldName: string, newName: string, context = 3): string {
  const a = splitLines(oldText), b = splitLines(newText);
  const ops = align(a, b);
  if (ops.every((o) => o[0] === "=")) return "";
  let out = `--- ${oldName}\n+++ ${newName}\n`;
  const changes = ops.map((o, i) => [o, i] as const).filter(([o]) => o[0] !== "=").map(([, i]) => i);
  let start = 0;
  while (start < changes.length) {
    let end = start;
    while (end + 1 < changes.length && changes[end + 1] - changes[end] <= 2 * context + 1) end++;
    const from = Math.max(0, changes[start] - context);
    const to = Math.min(ops.length - 1, changes[end] + context);
    let aStart = 0, bStart = 0;
    for (let i = 0; i < from; i++) {
      if (ops[i][0] !== "+") aStart++;
      if (ops[i][0] !== "-") bStart++;
    }
    const hunk = ops.slice(from, to + 1);
    const aLen = hunk.filter((o) => o[0] !== "+").length, bLen = hunk.filter((o) => o[0] !== "-").length;
    out += `@@ -${range(aStart, aLen)} +${range(bStart, bLen)} @@\n`;
    for (const [op, line] of hunk) out += `${op === "=" ? " " : op}${line}\n`;
    start = end + 1;
  }
  return out;
}

const range = (start: number, length: number) => (length === 0 ? `${start},0` : length === 1 ? `${start + 1}` : `${start + 1},${length}`);

/** The text's lines, ignoring trailing newlines. */
function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  let end = text.length;
  while (end > 0 && text[end - 1] === "\n") end--;
  return text.slice(0, end).split("\n");
}

function align(a: string[], b: string[]): [Op, string][] {
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops: [Op, string][] = [];
  let x = 0, y = 0;
  while (x < a.length && y < b.length) {
    if (a[x] === b[y]) {
      ops.push(["=", a[x]]);
      x++;
      y++;
    } else if (lcs[x + 1][y] >= lcs[x][y + 1]) ops.push(["-", a[x++]]);
    else ops.push(["+", b[y++]]);
  }
  while (x < a.length) ops.push(["-", a[x++]]);
  while (y < b.length) ops.push(["+", b[y++]]);
  return ops;
}
