// `vsdev render <file>...`. Relative paths are resolved against the user's directory (INIT_CWD under `npm run`, which runs
// workspace scripts from the workspace folder; the process's own directory as a global command).
import { bold, cyan, dim, green, red, yellow } from "../moddb/ansi.js";
import path from "node:path";
import { CliError } from "../errors.js";
import { userCwd } from "../paths.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { findAsset } from "../commands/screenshots.js";
import { defaultLocationEnv, resolveGameDir, resolveModsDir } from "../locations.js";
import { formatCheck } from "../shape/check.js";
import { parseArgs, USAGE } from "./args.js";
import { statueIo } from "./statues.js";
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
    if (s.statues) lines.push(`  statues drawn as their figure: ${s.statues}${s.multiblock ? ` (${s.multiblock} invisible multiblock parts left out)` : ""}`);
    for (const w of s.warnings) lines.push(yellow(`  ${w}`));
    lines.push(`  most common: ${s.top.map((t) => `${t.code} x${t.count}`).join(", ")}`);
  } else {
    const s = result.summary;
    lines.push(`${cyan(rel(result.file))}${dim(":")} ${bold("ChiselTools shape")}${s.name ? ` "${s.name}"` : ""}, ${s.cuboids} cuboids, ${s.voxels} of 4096 voxels`);
    lines.push(`  materials: ${s.materials.map((m) => `${m.code} (${m.voxels})`).join(", ")}`);
  }
  if (result.kind === "model" && result.compare) {
    const c = result.compare, box = (e: { min: number[]; max: number[] }) => e.min.map((v, i) => `${v}..${e.max[i]}`).join("  ");
    lines.push(`  compared with ${rel(c.old)}: ${c.added.length} added, ${c.removed.length} removed, ${c.moved.length} moved or resized, ${c.unchanged} unchanged`);
    for (const p of c.added.slice(0, 20)) lines.push(green(`    + ${p}`));
    for (const p of c.removed.slice(0, 20)) lines.push(red(`    - ${p}`));
    for (const m of c.moved.slice(0, 20)) lines.push(`    ~ ${m.path}: ${box(m.was)} ${dim("->")} ${box(m.now)}`);
    const more = Math.max(0, c.added.length - 20) + Math.max(0, c.removed.length - 20) + Math.max(0, c.moved.length - 20);
    if (more) lines.push(dim(`    ... and ${more} more (--json lists all)`));
  }
  if (result.kind === "model" && result.check) {
    for (const line of formatCheck(result.check, { elements: true })) {
      lines.push(`  ${line.startsWith("error:") ? red(line) : line.startsWith("warning:") ? yellow(line) : line.startsWith("note:") ? dim(line) : line}`);
    }
  }
  for (const image of result.images) lines.push(`  ${green("→")} ${rel(image)}`);
  return lines;
}

/** Runs the command; throws UsageError for a bad command line and CliError when rendering fails. */
export async function runRender(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, path.join(cwd, ".vsdev/renders"));
  if (parsed === "help") {
    console.log(USAGE);
    return 0;
  }
  const options = {
    ...parsed,
    out: path.resolve(cwd, parsed.out),
    files: parsed.files.map((f) => path.resolve(cwd, f)),
    game: parsed.game && path.resolve(cwd, parsed.game),
    compare: parsed.compare && path.resolve(cwd, parsed.compare),
    blockColors: parsed.blockColors && path.resolve(cwd, parsed.blockColors),
    cwd,
  };
  // Statues in a schematic are built from the game's shapes (any install, a server will do) and the mod's own, from the mods folder.
  const env = defaultLocationEnv(cwd);
  const gameDir = resolveGameDir({ mode: "read", flag: options.game }, env).path;
  const modsDir = resolveModsDir({ mode: "read" }, env).path;
  const tmp = mkdtempSync(path.join(tmpdir(), "vsdev-render-"));
  let results: RenderedInput[];
  try {
    results = await renderFiles({ ...options, statueIo: statueIo((ref) => findAsset(ref, gameDir, modsDir, tmp)?.file, gameDir ? path.join(gameDir, "assets") : undefined) });
  } catch (err) {
    if (err instanceof RenderError) throw new CliError(err.message);
    throw err;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (options.json) {
    console.log(JSON.stringify(results.map(({ centerPixels: _, ...r }) => ({ ...r, file: rel(r.file), images: r.images.map(rel) })), null, 2));
  } else {
    const foundClient = options.noTextures || !!(await gameAssetsFor(options.game, cwd).catch(() => "explicit"));
    const hint = foundClient ? "" : " (no game client found: pass --game-dir, or set $VINTAGE_STORY to your installed game; see `vsdev paths`)";
    for (const result of results) console.log(describe(result, hint).join("\n"));
  }
  // --check fails the command on a shape's errors (with --strict, its warnings too), after everything was reported.
  const failed = results.some((r) => r.kind === "model" && r.check && (r.check.errors > 0 || (options.strict && r.check.warnings > 0)));
  return failed ? 1 : 0;
}
