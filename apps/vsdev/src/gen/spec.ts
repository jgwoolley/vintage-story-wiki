// Loading a `vsdev texture` / `vsdev shape` spec: JSON (JSON5 allowed: comments, trailing commas) or a JS module (.js/.mjs) whose
// default export is the spec, or a function (sync or async) that gets the helpers and returns it. A module is the way to loop,
// mirror and parameterize; it runs as ordinary code, like any script you'd run yourself.
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSON5 from "json5";
import { CliError } from "../errors.js";

export async function loadSpec(file: string, helpers: Record<string, unknown>): Promise<Record<string, unknown>> {
  let spec: unknown;
  if (/\.(m?js)$/i.test(file)) {
    const mod = await import(pathToFileURL(file).href);
    spec = mod.default;
    if (typeof spec === "function") spec = await (spec as (h: unknown) => unknown)(helpers);
  } else {
    try {
      spec = JSON5.parse(readFileSync(file, "utf8"));
    } catch (err) {
      throw new CliError(`${path.basename(file)}: ${(err as Error).message}`);
    }
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new CliError(`${path.basename(file)}: the spec must be an object (a JS module: export default an object or a function returning one)`);
  return spec as Record<string, unknown>;
}

/** A spec error: names the file and the place in it, so the fix is obvious. */
export class SpecError extends Error {}

/** Picks names: `--only a,b` (exact or `prefix*`) against a spec's keys. Unknown names are an error that lists the real ones. */
export function selectNames(all: string[], only: string[] | undefined, what: string): string[] {
  if (!only?.length) return all;
  const out = all.filter((n) => only.some((o) => (o.endsWith("*") ? n.startsWith(o.slice(0, -1)) : n === o)));
  if (!out.length) throw new CliError(`no ${what} matches --only ${only.join(",")} (there are: ${all.join(", ")})`);
  return out;
}
