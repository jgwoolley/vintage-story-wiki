// Where the wiki's pipeline finds the game and the mods: vsdev's location rule (apps/vsdev/src/locations.ts), so the wiki,
// vsdev and a mod project agree, but limited to flag/env/config/local. The wiki never falls back to a real installed game or data
// folder: it has to build from the server version pinned in vs-manifest.json, and CI must not depend on what's installed.
//   game:  $VINTAGE_STORY, vs-manifest.json gameDir, else ./vintagestory (or an old ./vs_server)
//   mods:  $VINTAGE_STORY_DATA (its Mods/), vs-manifest.json dataDir (its Mods/), else ./Mods
// Paths inside the repo come back relative ("vintagestory", "Mods"), so nothing absolute reaches the generated data.
import { readFileSync } from "node:fs";
import path from "node:path";
import { defaultLocationEnv, gameInfo, LOCAL_GAME_DIR, resolveGameDir, resolveModsDir } from "@nf3t/vsdev/locations.js";

const relativeIfInside = (p: string) => {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : p;
};

/** The game install ingest reads (its `assets/` holds the vanilla domains). */
export function wikiGameDir(): string {
  const found = resolveGameDir({ mode: "read", installed: false }, defaultLocationEnv(process.cwd()));
  return relativeIfInside(found.path ?? path.join(process.cwd(), LOCAL_GAME_DIR));
}

/** The folder of mod zips ingest reads and `npm run download` writes. */
export function wikiModsDir(): string {
  const found = resolveModsDir({ mode: "read", installed: false }, defaultLocationEnv(process.cwd()));
  return relativeIfInside(found.path ?? path.join(process.cwd(), "Mods"));
}

/**
 * A warning when the game install isn't the version vs-manifest.json pins (e.g. a global $VINTAGE_STORY pointing ingest at someone's own
 * client), or undefined when it matches or can't be told.
 */
export function gameVersionMismatch(gameDir: string): string | undefined {
  let pinned: string | undefined;
  try {
    const manifest = JSON.parse(readFileSync("vs-manifest.json", "utf8")) as { serverVersion?: string; gameVersion?: string };
    pinned = manifest.gameVersion ?? manifest.serverVersion;
  } catch {
    return undefined;
  }
  const found = gameInfo(gameDir)?.version;
  if (!pinned || !found || found === pinned) return undefined;
  return `the game install at ${gameDir} is version ${found}, but vs-manifest.json pins ${pinned}; the wiki will show ${found}'s data (unset $VINTAGE_STORY / gameDir, or run npm run download)`;
}
