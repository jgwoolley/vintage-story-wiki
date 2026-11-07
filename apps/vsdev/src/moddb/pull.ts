// `vsdev moddb pull`: moddb/<modid>/ rewritten from the live pages (also replaces a scaffold once the mod is published). A port of
// ModDbCli's PullCommand.cs: everything is planned first; files that differ from the live page are listed and only overwritten after a
// [y/N] (or --yes); without a terminal it refuses. Drafts aren't pulled (the API doesn't list them), as in ModDbCli.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildFiles, imageUrls } from "./files.js";
import type { LiveClient } from "./live.js";

export interface PullPlan {
  modid: string;
  /** Whether the mod has a live page. */
  published: boolean;
  /** Whether a placeholder folder exists for an unpublished mod. */
  hasFolder: boolean;
  /** Relative path -> new content, for files that are new or differ. */
  writes: Map<string, Buffer>;
  /** Existing files among `writes` (their local content is lost). */
  overwrites: string[];
  /** Files considered in total. */
  total: number;
}

export async function planPull(client: LiveClient, pagesDir: string, modid: string): Promise<PullPlan> {
  const modDir = path.join(pagesDir, modid);
  const mod = await client.mod(modid);
  const plan: PullPlan = { modid, published: !!mod, hasFolder: existsSync(modDir), writes: new Map(), overwrites: [], total: 0 };
  if (!mod) return plan;
  const consider = (name: string, data: Buffer) => {
    plan.total++;
    const file = path.join(modDir, name);
    if (existsSync(file)) {
      if (readFileSync(file).equals(data)) return;
      plan.overwrites.push(name);
    }
    plan.writes.set(name, data);
  };
  for (const [name, text] of Object.entries(buildFiles(modid, mod))) consider(name, Buffer.from(text, "utf8"));
  for (const [name, url] of Object.entries(imageUrls(mod))) consider(name, await client.bytes(url));
  return plan;
}
