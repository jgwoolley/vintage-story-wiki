// `vsdev texture <spec>...`: paints textures from a spec (layers of fills, tiling noise, grain, chips, scratches, bevels, bricks,
// shapes and pixel art; src/texture/paint.ts) into PNGs, and writes a preview sheet to look at.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCommand } from "../args.js";
import { UsageError } from "../errors.js";
import { loadEntries, specStep } from "../gen/command.js";
import { encodePng, type RgbaImage } from "../gen/png.js";
import { cyan, dim, green } from "../moddb/ansi.js";
import { userCwd } from "../paths.js";
import { paintTexture, type ColorValue, type TextureSpec } from "../texture/paint.js";
import { previewSheet } from "../texture/preview.js";

export const TEXTURE_USAGE = `Usage: vsdev texture <spec>... [--out <dir>] [--only a,b*] [--no-preview] [--dry-run] [--json]

Paints PNG textures from a spec file: JSON (comments allowed) or a JS module (.js/.mjs) exporting the spec, or a function that gets
helpers (mirrorRows, ...) and returns it. Same spec, same pixels: everything random is seeded. Noise wraps, so textures tile.

  {
    "out": "assets/mymod/textures/block",          // relative to the spec file (or --out)
    "colors": { "bronze": "#76603c", "grime": "#30281c" },
    "textures": {
      "bronze": { "size": 32, "seed": 1, "layers": [
        { "type": "fill", "color": "bronze" },
        { "type": "grain", "amount": 0.16 },
        { "type": "noise", "color": "grime", "scale": 8, "opacity": 0.6 },
        { "type": "noise", "color": "#587c64", "scale": 4, "coverage": 0.2 },
        { "type": "speckle", "shade": 0.45, "density": 0.004 },
        { "type": "scratches", "count": 4 },
        { "type": "bevel", "width": 2 }
      ] }
    }
  }

Every layer paints with "color" (mix towards it) or "shade" (multiply brightness), times "opacity", inside "region" [x, y, w, h].
Layers: fill, gradient (direction down/up/left/right/radial/edges, power), noise (scale, octaves, coverage = share of pixels,
softness), grain (amount, scale), speckle (density, size), scratches (count, length), border (width, inset), bevel (width, light,
dark, sunken), circle (center, radius, ring), line (from, to, width), bricks (size, mortar, mortarWidth, offset, variation, bevel),
pixels (at, rows, colors, shadow, scale, mirror). A texture name may hold "/" for subfolders.

Options:
  --out <dir>     write here instead of the spec's "out"
  --only <names>  only these textures (comma-separated, "prefix*" allowed)
  --no-preview    don't write the preview sheet (.vsdev/renders/textures-<spec>.png: each texture tiled 2 x 2, enlarged, labelled)
  --dry-run       check the spec and paint, write nothing
  --json          print what was written as JSON`;

export async function runTexture(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, {
    out: { type: "string" }, only: { type: "string" }, "no-preview": { type: "boolean" }, "dry-run": { type: "boolean" }, json: { type: "boolean" },
  });
  if (values.help) {
    console.log(TEXTURE_USAGE);
    return 0;
  }
  if (!positionals.length) throw new UsageError("texture needs a spec file");
  const cwd = userCwd();
  const rel = (f: string) => path.relative(cwd, f) || f;
  const report: { spec: string; textures: { name: string; file: string; width: number; height: number }[]; preview?: string }[] = [];
  for (const arg of positionals) {
    const file = path.resolve(cwd, arg);
    const loaded = await loadEntries(file, "textures", values.out && path.resolve(cwd, values.out), values.only?.split(","));
    const colors = (loaded.spec.colors ?? {}) as Record<string, ColorValue>;
    const painted: { name: string; image: RgbaImage; file: string }[] = loaded.entries.map(([name, def]) => ({
      name,
      image: specStep(file, () => paintTexture(def as TextureSpec, colors, `texture "${name}"`)),
      file: path.join(loaded.out, `${name}.png`),
    }));
    const entry: (typeof report)[number] = { spec: rel(file), textures: painted.map((p) => ({ name: p.name, file: rel(p.file), width: p.image.width, height: p.image.height })) };
    if (!values["dry-run"]) {
      for (const p of painted) {
        mkdirSync(path.dirname(p.file), { recursive: true });
        writeFileSync(p.file, encodePng(p.image));
      }
      if (!values["no-preview"]) {
        const preview = path.join(cwd, ".vsdev/renders", `textures-${path.basename(file).replace(/\.[^.]+$/, "")}.png`);
        mkdirSync(path.dirname(preview), { recursive: true });
        writeFileSync(preview, encodePng(previewSheet(painted)));
        entry.preview = rel(preview);
      }
    }
    report.push(entry);
  }
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  for (const r of report) {
    console.log(`${cyan(r.spec)}${dim(":")} ${r.textures.length} texture${r.textures.length === 1 ? "" : "s"}${values["dry-run"] ? dim(" (dry run, nothing written)") : ""}`);
    for (const t of r.textures) console.log(`  ${green("→")} ${t.file} ${dim(`${t.width}x${t.height}`)}`);
    if (r.preview) console.log(`  ${green("→")} ${r.preview} ${dim("(preview: look at this one)")}`);
  }
  return 0;
}
