// `vsdev shape <spec>...`: builds the game's shape JSON from boxes, joints, reliefs, mirrors and repeats (src/shape/build.ts), and
// with --render draws the result like `vsdev render`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCommand } from "../args.js";
import { UsageError } from "../errors.js";
import { loadEntries, specStep } from "../gen/command.js";
import { cyan, dim, green, red, yellow } from "../moddb/ansi.js";
import { userCwd } from "../paths.js";
import { runRender } from "../render/cli.js";
import { shapeBounds, type Bounds } from "../shape/bounds.js";
import { buildShape, type ShapeSpec } from "../shape/build.js";
import { checkShape, type CheckFinding } from "../shape/check.js";
import { setGameDir } from "../shape/game.js";
import { guiTransform, writeGuiTransforms, type GuiConfig, type GuiTransform } from "../shape/gui.js";

export const SHAPE_USAGE = `Usage: vsdev shape <spec>... [--out <dir>] [--only a,b*] [--render] [--check] [--strict] [--dry-run] [--json] [--game-dir <dir>]

Builds shape files (the game's model JSON) from a spec: JSON (comments allowed) or a JS module (.js/.mjs) exporting the spec, or a
function that gets helpers (box, joint, relief, mirror, corners, place, band, taper, repeat, mirrorRows) and returns it. Units are the game's: 16 = one block,
x east, y up, z south.

  {
    "out": "assets/mymod/shapes/block",            // relative to the spec file (or --out)
    "shapes": {
      "lantern": {
        "textures": { "metal": "mymod:block/bronze", "glass": "game:block/glass/plain" },
        "elements": [
          { "box": [[5, 0, 5], [11, 1, 11]], "tex": "metal", "name": "base" },
          { "box": [[5.5, 1, 5.5], [10.5, 7, 10.5]], "tex": "glass", "faces": { "up": false, "down": false } },
          { "mirror": { "box": [[5, 1, 5], [6, 7, 6]], "tex": "metal", "name": "postleft" } },
          { "joint": [8, 7, 8], "rot": [0, 45, 0], "children": [{ "box": [[-2, 0, -2], [2, 2, 2]], "tex": "metal", "name": "cap" }] },
          { "relief": [".#.", "###", ".#."], "at": [6.5, 6, 11], "cell": 1, "depth": 0.5, "tex": "metal" }
        ]
      }
    }
  }

box: [[from], [to]] with "tex"; each face gets a UV as big as that side (one texel per unit, at most the texture), so textures are
never stretched. "faces" overrides sides: { "south": "otherkey" }, { "south": { "texture": "k", "uv": "full" | [u1,v1,u2,v2],
"rotation": 90 } }, { "down": false } (no face). "uv": [u, v] shifts where the faces start. "rot": [x, y, z] degrees about "origin"
(default: the box's center). "children" are placed relative to the parent's "from" and turn with it.
joint: [x, y, z]: an empty pivot (rot, children); how limbs are posed.
relief: pixel-art rows ("#" filled, or "fill"), facing south from "at" (top-left front corner), "cell" units per pixel, "depth".
mirror: element(s), copied mirrored across x = "about", or "axis": "z"; left/right in names are swapped. "about" defaults to the
middle of the coordinates the element is written in: 8 in the block, 0 inside a joint, half the parent's size inside a box.
corners: element(s) copied to all four corners round "about": [x, z] (same default), named <name>-nw, -ne, -sw, -se (n = -z, e = +x):
four table legs from one.
repeat: n copies of "of", each moved by "step" [dx, dy, dz].

Placing a box by what it touches, instead of working out coordinates (a slip there is how parts end up floating or flush):
  { "size": [w, h, d], "on": "body", "tex": "k" }            on top of the element named "body", centered on it
  { "size": [w, h, d], "under": "top" }                      hanging below it
  { "size": [w, h, d], "against": ["body", "south"] }        against that face (north south east west up down), outside it
  { "size": [w, h, d], "center": [8, 4, 8] } / "base": [8, 0, 8]    around a point / standing on one
  a null in "size" = as big as the target there; "grow": 0.5 makes that 0.5 bigger each side (an overhanging lid).
  "align": ["west", "north"] lines those sides up with the target's instead of centering; "inset": 1 keeps it that far in.
  "sink": 0.5 pushes it that far into the target; "offset": [dx, dy, dz] moves it after everything else.
  The target is an element written earlier in the same list, "parent" (the box these children belong to) or "block" (0..16).
band: "name", with one of "x" | "y" | "z": [from, to] and "out" (default 0.25): a strip round that element, standing proud of it on
the other two axes (an iron band round a chest), so its faces never lie in the element's faces and flicker.
taper: [[from], [to]] with "top": [width, depth] and "steps" (default 3): slabs narrowing from the base box to the top (a roof,
a plinth, a spire); named <name>-1 (bottom) upward.

"poses" on a shape: { "open": { "lid": [-70, 0, 0] } } also writes <shape>-open.json with the element named "lid" turned that way
(replacing its "rot"), so a lid can be looked at open and closed. Turn signs: a positive x turn tips the top toward south (+z),
so a lid hinged along its north edge opens with a NEGATIVE x; positive y turns counter-clockwise seen from above; positive z tips
the top toward west (-x).

Every shape is checked as it is built (the same checks as "vsdev render --check"): parts that touch nothing, faces of different
textures in one plane (they flicker in game), flat parts lying in a face, UVs off the texture. Read them: they are the mistakes
that are hard to see in a picture.
"ground": true on a top-level element (a loose piece) moves it up or down until its lowest point is on y = 0; on a shape, the whole
model. Each shape's bounds are printed (and in --json): check that nothing floats, and use them for a block's guiTransform.
Game JSON (an element with "from"/"to") is copied as is. "extra" on a shape or element is merged into the output.
"prune": true (on a shape, or the whole spec) leaves the texture keys no face uses out of the file instead of warning about them.

Inventory icons: each shape's guiTransform (origin = the bounds' centre in blocks, scale = its longest side fits "fit" blocks) is
printed; "gui": { "file": "../blocktypes/thing.json", "key": "*-{name}-*", "rotateY": 180 } in the spec writes them into that
blocktype's guiTransformByType (one line per key; an existing line keeps its rotation). rotateY is the turn of the variant the
inventory shows; "fit" (default 0.95 blocks), "maxScale" (1.1) and "rotation" ([-22.6, -45.3, 0]) can be set too, and "keepScale":
true keeps the scale of entries already there (tuned by eye), moving only their origin.

A JS spec's function also gets: bar(from, to, width, tex) (a box along a line), prism({ apothem, y: [y0, y1], sides, lean, tex,
panel }) (an n-sided section of panels, really n-sided, can taper), scaled(k, elements), texturesFor(textures, elements),
aim(direction), gameShape("entity/humanoid/seraph-faceless") (a shape from the game install), statue(shape, { animation, keyframe,
texture, scale, drop, attach }) (posed and in one material, as the Player Statues mod makes them), animationPose(shape, code, i),
and project(shapeSpec, { width, side }) (the model seen straight on, as pixel rows for a texture).

Options:
  --out <dir>     write here instead of the spec's "out"
  --only <names>  only these shapes (comma-separated, "prefix*" allowed)
  --render        render what was written (vsdev render's default views; textures found under the shape's assets/<domain>/)
  --check         exit 1 when a shape has an error (a floating part); --strict: when it has a warning too
  --dry-run       check the spec, write nothing
  --json          print what was written as JSON
  --game-dir <d>  the game install gameShape reads (default: as vsdev render finds it)`;

export async function runShape(argv: string[]): Promise<number> {
  const { values, positionals } = parseCommand(argv, {
    out: { type: "string" }, only: { type: "string" }, render: { type: "boolean" }, "dry-run": { type: "boolean" }, json: { type: "boolean" },
    check: { type: "boolean" }, strict: { type: "boolean" },
    "game-dir": { type: "string" },
  });
  if (values.help) {
    console.log(SHAPE_USAGE);
    return 0;
  }
  if (!positionals.length) throw new UsageError("shape needs a spec file");
  if (values.strict && !values.check) throw new UsageError("--strict goes with --check");
  if (values.render && values["dry-run"]) throw new UsageError("--render needs the files written; drop --dry-run");
  const cwd = userCwd();
  const rel = (f: string) => path.relative(cwd, f) || f;
  if (values["game-dir"]) setGameDir(path.resolve(cwd, values["game-dir"]));
  const report: { spec: string; gui?: { file: string; added: string[]; changed: string[] }; shapes: { name: string; file: string; elements: number; bounds?: Bounds; guiTransform?: GuiTransform; unusedTextures: string[]; check: ShapeFindings }[] }[] = [];
  const written: string[] = [];
  for (const arg of positionals) {
    const file = path.resolve(cwd, arg);
    const loaded = await loadEntries(file, "shapes", values.out && path.resolve(cwd, values.out), values.only?.split(","));
    const prune = loaded.spec.prune === true;
    const gui = (loaded.spec.gui ?? undefined) as GuiConfig | undefined;
    if (gui !== undefined && (typeof gui !== "object" || Array.isArray(gui))) throw new UsageError(`${rel(file)}: "gui" is an object ({ file, key, rotateY, fit, maxScale, rotation })`);
    const shapes = loaded.entries.flatMap(([name, def]) => {
      const withPrune = def && typeof def === "object" && prune && (def as ShapeSpec).prune === undefined ? { ...(def as ShapeSpec), prune } : def;
      const { shape, unused, bounds, poses } = specStep(file, () => buildShape(withPrune as ShapeSpec, `shape "${name}"`));
      const main = { name, shape, unused, bounds, guiTransform: bounds ? guiTransform(bounds, gui) : undefined, file: path.join(loaded.out, `${name}.json`), pose: false };
      // A pose is the same model to look at, not another block: no icon transform, and its unused textures are the shape's own.
      const posed = Object.entries(poses ?? {}).map(([pose, posedShape]) => ({
        name: `${name}-${pose}`, shape: posedShape, unused: [] as string[], bounds: shapeBounds(posedShape.elements as Parameters<typeof shapeBounds>[0]), guiTransform: undefined,
        file: path.join(loaded.out, `${name}-${pose}.json`), pose: true,
      }));
      return [main, ...posed];
    });
    if (!values["dry-run"]) {
      for (const s of shapes) {
        mkdirSync(path.dirname(s.file), { recursive: true });
        writeFileSync(s.file, JSON.stringify(s.shape, null, 2) + "\n");
        written.push(s.file);
      }
    }
    let guiReport: { file: string; added: string[]; changed: string[] } | undefined;
    if (gui?.file && !values["dry-run"]) {
      const target = path.resolve(path.dirname(file), gui.file);
      const keyOf = (n: string) => (gui.key ?? "*-{name}-*").replaceAll("{name}", n);
      const done = specStep(file, () => writeGuiTransforms(target, shapes.filter((s) => s.guiTransform && !s.pose).map((s) => [keyOf(s.name), s.guiTransform!]), { keepScale: gui.keepScale }));
      guiReport = { file: rel(target), ...done };
    }
    report.push({ spec: rel(file), ...(guiReport ? { gui: guiReport } : {}), shapes: shapes.map((s) => ({ name: s.name, file: rel(s.file), elements: countElements(s.shape.elements), ...(s.bounds ? { bounds: roundBounds(s.bounds) } : {}), ...(s.guiTransform ? { guiTransform: s.guiTransform } : {}), unusedTextures: s.unused, check: findingsOf(s.shape) })) });
  }
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else {
    for (const r of report) {
      console.log(`${cyan(r.spec)}${dim(":")} ${r.shapes.length} shape${r.shapes.length === 1 ? "" : "s"}${values["dry-run"] ? dim(" (dry run, nothing written)") : ""}`);
      for (const s of r.shapes) {
        console.log(`  ${green("→")} ${s.file} ${dim(`${s.elements} elements${s.bounds ? ", " + "xyz".split("").map((a, i) => `${a} ${s.bounds!.min[i]}..${s.bounds!.max[i]}`).join(", ") : ""}`)}`);
        if (s.guiTransform) console.log(dim(`    icon: origin ${s.guiTransform.origin.x} ${s.guiTransform.origin.y} ${s.guiTransform.origin.z}, scale ${s.guiTransform.scale}`));
        if (s.unusedTextures.length) console.log(yellow(`    textures no face uses: ${s.unusedTextures.join(", ")}`));
        for (const line of findingLines(s.check)) console.log(`    ${line.startsWith("error:") ? red(line) : line.startsWith("warning:") ? yellow(line) : dim(line)}`);
      }
      if (r.gui) console.log(`  ${green("→")} ${r.gui.file} ${dim(`guiTransformByType: ${r.gui.added.length} added, ${r.gui.changed.length} changed`)}`);
    }
  }
  if (values.render && written.length) await runRender(written);
  const all = report.flatMap((r) => r.shapes.map((s) => s.check));
  return values.check && all.some((c) => c.errors || (values.strict && c.warnings)) ? 1 : 0;
}

/** What `vsdev render --check` finds in a built shape, without its per-element table. */
interface ShapeFindings { errors: number; warnings: number; notes: number; findings: CheckFinding[] }

function findingsOf(shape: unknown): ShapeFindings {
  const { errors, warnings, notes, findings } = checkShape(shape);
  return { errors, warnings, notes, findings };
}

/** Errors and warnings in full (at most 8 of a kind), notes as a count: a generated model can have hundreds of harmless ones. */
function findingLines(check: ShapeFindings): string[] {
  const lines: string[] = [], seen = new Map<string, number>();
  for (const f of check.findings) {
    if (f.level === "note") continue;
    const n = (seen.get(f.code) ?? 0) + 1;
    seen.set(f.code, n);
    if (n <= 8) lines.push(`${f.level}: ${f.message}`);
  }
  for (const [code, n] of seen) if (n > 8) lines.push(`... and ${n - 8} more "${code}" (vsdev render <file> --check lists them)`);
  if (check.notes) lines.push(`${check.notes} note${check.notes === 1 ? "" : "s"} (vsdev render <file> --check shows them, with every element's bounds)`);
  return lines;
}

/** Bounds to a tenth of a unit: enough to place a model, short enough to read. */
function roundBounds(b: Bounds): Bounds {
  const r = (v: number[]) => v.map((n) => Math.round(n * 10) / 10 + 0) as Bounds["min"];
  return { min: r(b.min), max: r(b.max) };
}

function countElements(els: unknown): number {
  return Array.isArray(els) ? els.reduce((n: number, el) => n + 1 + countElements((el as { children?: unknown }).children), 0) : 0;
}
