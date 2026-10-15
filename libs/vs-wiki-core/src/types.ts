/** One physical location assets can be loaded from: a domain folder belonging to a mod (or vanilla). */
export interface AssetSource {
  domain: string; // e.g. "game", "survival", "creative", or a mod's own domain
  modid: string; // "game" for vanilla, otherwise the owning mod's id
  rootDir: string; // filesystem path to this domain's `assets/<domain>/` folder
}

/** One JSON asset file as loaded off disk, before any patching is applied. */
export interface LoadedAsset {
  domain: string;
  relPath: string; // path relative to the domain's assets root, e.g. "recipes/grid/anchor.json", no leading slash
  modid: string; // which mod this specific file came from (last-loaded wins on an override)
  sourceFile: string; // absolute filesystem path, for error messages
  json: unknown; // the parsed (JSON5-tolerant) file contents, unpatched
}

/** `domain:relPath` -> asset (last-loaded wins, matching the game engine's own override behavior). */
export type AssetIndex = Map<string, LoadedAsset>;

/** One operation from a `patches/**\/*.json` file, before `side`/`dependsOn`/`condition` filtering. */
export interface PatchOp {
  op: "add" | "remove" | "replace" | "addmerge" | string; // "addmerge" is VS-specific: merge-append into an array/object rather than replace
  path: string; // JSON-pointer-style path into the target file
  value?: unknown;
  file: string; // target file this patch applies to, e.g. "game:worldgen/structures.json" (domain prefix optional)
  side?: "Server" | "Client" | "Universal"; // only "Server"/"Universal" patches matter to this pipeline (no client-only state)
  condition?: { when: string; isValue?: unknown; useValue?: boolean }; // gated on a world-creation config value; "Default" preset is assumed
  dependsOn?: { modid: string; invert?: boolean }[]; // only applied if the named mod is (or, if invert, is not) present
  // Provenance attached by the loader itself, not read off the JSON -- lets later error messages
  // and the `compatibility/<othermodid>/` folder convention trace a patch back to its source file.
  __modid?: string;
  __sourceFile?: string;
  __domain?: string;
}
