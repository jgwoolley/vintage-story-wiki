// What `vsdev texture` and `vsdev shape` share: loading each spec file (with the helpers a JS spec gets), finding its output folder,
// picking entries with --only, and turning spec mistakes into one clear error line.
import path from "node:path";
import { CliError } from "../errors.js";
import { shapeHelpers } from "../shape/build.js";
import { animationPose, gameShape, statue } from "../shape/game.js";
import { aim, bar, prism, scaled, texturesFor } from "../shape/helpers.js";
import { project } from "../shape/project.js";
import { mirrorRows } from "../texture/paint.js";
import { loadSpec, selectNames, SpecError } from "./spec.js";

/** Passed to a JS spec module's default-exported function (texture and shape specs get the same ones). */
export const specHelpers = { ...shapeHelpers, mirrorRows, aim, bar, prism, scaled, texturesFor, gameShape, statue, animationPose, project };

export interface LoadedSpec { file: string; spec: Record<string, unknown>; out: string; entries: [string, unknown][] }

/** Loads a spec and its `key` map (textures / shapes); the output folder is --out, else the spec's "out" (relative to the spec file). */
export async function loadEntries(file: string, key: string, outFlag: string | undefined, only: string[] | undefined): Promise<LoadedSpec> {
  const name = path.basename(file);
  const spec = await loadSpec(file, specHelpers);
  const map = spec[key];
  if (!map || typeof map !== "object" || Array.isArray(map)) throw new CliError(`${name}: needs "${key}", an object of name -> definition`);
  const outSpec = spec.out;
  if (outSpec !== undefined && typeof outSpec !== "string") throw new CliError(`${name}: "out" is a folder (relative to the spec file)`);
  const out = outFlag ?? (outSpec ? path.resolve(path.dirname(file), outSpec) : undefined);
  if (!out) throw new CliError(`${name}: say where the files go: "out" in the spec (relative to it), or --out`);
  const names = selectNames(Object.keys(map), only, key.replace(/s$/, ""));
  for (const n of names) if (!/^[\w.-]+(\/[\w.-]+)*$/.test(n) || n.split("/").includes("..")) throw new CliError(`${name}: "${n}" is not a usable file name (letters, digits, - _ . and / for subfolders)`);
  return { file, spec, out, entries: names.map((n) => [n, (map as Record<string, unknown>)[n]]) };
}

/** Runs `fn`, reporting a SpecError as a CliError naming the spec file. */
export function specStep<T>(file: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof SpecError) throw new CliError(`${path.basename(file)}: ${err.message}`);
    throw err;
  }
}
