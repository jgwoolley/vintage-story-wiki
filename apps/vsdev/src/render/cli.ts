// `vsdev render <file>...`. Relative paths are resolved against the user's directory (INIT_CWD under `npm run`, which runs
// workspace scripts from the workspace folder; the process's own directory as a global command).
import { bold, cyan, dim, green, yellow } from "../moddb/ansi.js";
import path from "node:path";
import { CliError } from "../errors.js";
import { userCwd } from "../paths.js";
import { parseArgs, USAGE } from "./args.js";
import { gameAssetsFor, renderFiles, RenderError, type RenderedInput } from "./render.js";

export { USAGE };

const cwd = userCwd();
const rel = (file: string) => path.relative(cwd, file) || file;

/** The human-readable report of one file: what it is, then the images written. */
function describe(result: RenderedInput, hint: string): string[] {
  const lines: string[] = [];
  if (result.kind === "model") {
    const s = result.summary;
    lines.push(`${cyan(rel(result.file))}${dim(":")} ${bold("model")}, ${s.boxes} boxes, textures ${s.textures.join(", ") || "(none)"}`);
    if (s.wornItem) lines.push(s.placedOnBody ? dim("  worn item, placed on the player body") : yellow("  worn item, pieces unplaced (seraph-faceless.json not found under assets/<domain>/shapes or --game)"));
    if (s.textured.length || s.missing.length) lines.push(`  textured: ${s.textured.length} of ${s.textures.length} keys`);
    for (const m of s.missing) lines.push(yellow(`  not found: #${m.key} ${m.ref}${hint}`));
    if (s.animations.length) lines.push(`  animations: ${s.animations.map((a) => `${a.code} (${a.frames} frames)`).join(", ")}`);
  } else if (result.kind === "schematic") {
    const s = result.summary;
    lines.push(`${cyan(rel(result.file))}${dim(":")} ${bold("schematic")}, ${s.size.join(" x ")} (x, y, z), ${s.blocks} blocks of ${s.kinds} kinds, ${s.drawn} drawn`);
    if (s.hiddenFiller) lines.push(`  ${s.hiddenFiller} meta-filler hidden (--show-filler draws them)`);
    if (s.chiseled || s.chiselFailed) lines.push(`  chiseled blocks drawn as cuboids: ${s.chiseled}${s.chiselFailed ? `, unreadable (drawn as cubes): ${s.chiselFailed}` : ""}`);
    lines.push(`  most common: ${s.top.map((t) => `${t.code} x${t.count}`).join(", ")}`);
  } else {
    const s = result.summary;
    lines.push(`${cyan(rel(result.file))}${dim(":")} ${bold("ChiselTools shape")}${s.name ? ` "${s.name}"` : ""}, ${s.cuboids} cuboids, ${s.voxels} of 4096 voxels`);
    lines.push(`  materials: ${s.materials.map((m) => `${m.code} (${m.voxels})`).join(", ")}`);
  }
  for (const image of result.images) lines.push(`  ${green("→")} ${rel(image)}`);
  return lines;
}

/** Runs the command; throws UsageError for a bad command line and CliError when rendering fails. */
export async function runRender(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv, path.join(cwd, ".vsdev/renders"));
  if (parsed === "help") {
    console.log(USAGE);
    return;
  }
  const options = {
    ...parsed,
    out: path.resolve(cwd, parsed.out),
    files: parsed.files.map((f) => path.resolve(cwd, f)),
    game: parsed.game && path.resolve(cwd, parsed.game),
    blockColors: parsed.blockColors && path.resolve(cwd, parsed.blockColors),
    cwd,
  };
  let results: RenderedInput[];
  try {
    results = await renderFiles(options);
  } catch (err) {
    if (err instanceof RenderError) throw new CliError(err.message);
    throw err;
  }
  if (options.json) {
    console.log(JSON.stringify(results.map(({ centerPixels: _, ...r }) => ({ ...r, file: rel(r.file), images: r.images.map(rel) })), null, 2));
  } else {
    const foundClient = options.noTextures || !!(await gameAssetsFor(options.game, cwd).catch(() => "explicit"));
    const hint = foundClient ? "" : " (no game client found: pass --game-dir, or set $VINTAGE_STORY to your installed game; see `vsdev paths`)";
    for (const result of results) console.log(describe(result, hint).join("\n"));
  }
}
