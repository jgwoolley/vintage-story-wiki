import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { AssetSource, WaypointIcon } from "../types.js";

const vanilla = JSON.parse(readFileSync(new URL("../waypointIconsVanilla.json", import.meta.url), "utf8")) as { icons: string[] };

/**
 * The waypoint icons the game's world map offers. WaypointMapLayer.cs builds the list from every
 * `textures/icons/worldmap/*.svg` asset (any mod can add some) and names each icon by its file name
 * with the extension and a leading ordering number ("01-turnip.svg" -> "turnip") removed -- that name is what a
 * waypoint's `icon` field and the `/waypoint addati` command take. The dedicated server download has no client
 * textures, so those files are only found when present on disk (a mod's, or a full game's); vanilla's own list
 * is committed in waypointIconsVanilla.json as the fallback.
 */
export function extractWaypointIcons(sources: AssetSource[]): WaypointIcon[] {
  const out = new Map<string, WaypointIcon>();
  const add = (code: string, source: string) => {
    if (!out.has(code)) out.set(code, { code, source });
  };
  for (const source of sources) {
    const dir = `${source.rootDir}/textures/icons/worldmap`;
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file.toLowerCase().endsWith(".svg")) add(file.replace(/\.[^.]*$/, "").replace(/\d+-/, ""), source.modid);
    }
  }
  for (const code of vanilla.icons) add(code, "game");
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}
