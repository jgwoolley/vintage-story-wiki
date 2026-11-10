// Finds the PNGs a model (shape) file's `textures` map names, the way the game resolves them, so the preview can show them.
// Pure path logic plus one injected file reader (no `vscode`, `fs` or DOM use), so the VS Code extension's host and the model renderer
// share it and it is unit tested under plain Node. Paths use "/" (VS Code URI paths, POSIX paths).
//
// A shape names textures as "[domain:]path" (e.g. "block/linen", "game:block/metal/sheet/brass1"); a path without a domain is in the
// shape's own domain. The file is `assets/<domain>/textures/<path>.png`. The vanilla "game" domain is split over three folders in the
// install (`assets/survival`, `assets/game`, `assets/creative`). The dedicated server ships almost no textures, so the game folder must
// be a client install.

/** The vanilla domain and the install folders that hold it. */
export const GAME_DOMAIN = "game";
const GAME_DOMAIN_DIRS = ["survival", "game", "creative"];

/** Where a model file sits: the `assets` folder above it and its domain, when it is inside `assets/<domain>/shapes/...`. */
export interface ModelLocation {
  assetsDir: string;
  domain: string;
}

export function modelLocation(filePath: string): ModelLocation | undefined {
  const parts = filePath.split("/");
  const at = parts.lastIndexOf("shapes");
  if (at < 2) return undefined;
  return { assetsDir: parts.slice(0, at - 1).join("/"), domain: parts[at - 1] };
}

export function parseTextureRef(ref: string, defaultDomain: string): { domain: string; path: string } {
  const colon = ref.indexOf(":");
  const domain = colon >= 0 ? ref.slice(0, colon) : defaultDomain;
  const path = (colon >= 0 ? ref.slice(colon + 1) : ref).replace(/^\/+/, "").replace(/\.png$/i, "");
  return { domain: domain.toLowerCase(), path };
}

/** The `assets` folders to search, most specific first: the model's own tree, then the game install's. */
export function textureCandidates(ref: string, model: ModelLocation | undefined, gameAssetsDir: string | undefined): string[] {
  const { domain, path } = parseTextureRef(ref, model?.domain ?? GAME_DOMAIN);
  const domainDirs = domain === GAME_DOMAIN ? GAME_DOMAIN_DIRS : [domain];
  const roots = [model?.assetsDir, gameAssetsDir].filter((r): r is string => !!r);
  const out: string[] = [];
  for (const root of [...new Set(roots)]) for (const dir of domainDirs) out.push(`${root}/${dir}/textures/${path}.png`);
  return out;
}

/** The `assets` folder of a chosen game folder: the install folder itself (with `assets/` inside) or its `assets` folder. */
export function gameAssetsCandidates(folder: string): string[] {
  let end = folder.length;
  while (end > 0 && (folder[end - 1] === "/" || folder[end - 1] === "\\")) end--;
  const trimmed = folder.slice(0, end);
  return [`${trimmed}/assets`, trimmed];
}

/** A file the game folder must have for textures to be found; the dedicated server lacks it. */
export const TEXTURE_PROBE = "survival/textures/block/linen.png";

export interface ResolvedTextures {
  /** Texture key (without "#") -> PNG as a data: URL. */
  images: Record<string, string>;
  /** Keys whose PNG wasn't found, with the path the shape names. */
  missing: { key: string; ref: string }[];
}

/** The shape's `textures` map (key -> "[domain:]path"), or empty when the item/block type supplies them instead. */
export function shapeTextureRefs(shape: unknown): Record<string, string> {
  const textures = (shape as { textures?: unknown } | null)?.textures;
  if (!textures || typeof textures !== "object") return {};
  return Object.fromEntries(Object.entries(textures).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/** Base64 of bytes with `btoa` (in browsers and Node), in chunks so a large image doesn't overflow the call stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function resolveTextures(
  shape: unknown,
  filePath: string,
  gameAssetsDir: string | undefined,
  readFile: (path: string) => Promise<Uint8Array | undefined>,
): Promise<ResolvedTextures> {
  const model = modelLocation(filePath);
  const result: ResolvedTextures = { images: {}, missing: [] };
  for (const [key, ref] of Object.entries(shapeTextureRefs(shape))) {
    let found: Uint8Array | undefined;
    for (const candidate of textureCandidates(ref, model, gameAssetsDir)) {
      found = await readFile(candidate);
      if (found) break;
    }
    if (found) result.images[key] = `data:image/png;base64,${toBase64(found)}`;
    else result.missing.push({ key, ref });
  }
  return result;
}
