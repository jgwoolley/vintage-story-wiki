#!/usr/bin/env -S npx tsx
// One-off, manually-run generator for src/ingest/csharpClassMap.json: which C# source file
// implements each block/item class, block entity class, and behavior name that the game's JSON
// assets reference (`class`, `entityClass`, `behaviors[].name`, `entityBehaviors[].name`).
//
// Reads the local, gitignored `vssurvivalmod/` reference clone (see CLAUDE.md) -- NOT part of
// `npm run download`/`ingest`/`build`, and the C# source itself never enters the project; only
// the resulting name -> file-path mapping is committed. Re-run by hand after updating that clone:
//
//   npx tsx scripts/map-csharp-classes.ts [path-to-vssurvivalmod-clone]
//
// How the mapping is derived: the mod's Systems/*.cs call
// `api.Register<Kind>Class("JsonName", typeof(TypeName))` for every name usable from JSON; the
// declaring file is then whichever .cs file contains `class TypeName` / `struct TypeName`.
// Names registered elsewhere (VSEssentials, the closed-source engine, mod DLLs) simply aren't in
// the map -- the site lists those without a link.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CSharpClassMap, CSharpRegistrationKind } from "../src/ingest/types.js";

const REPO = "anegostudios/vssurvivalmod";
const OUT = "src/ingest/csharpClassMap.json";

// Register<X>Class method name -> the registry it populates (see CSharpRegistrationKind).
const KINDS: Record<string, CSharpRegistrationKind> = {
  RegisterBlockClass: "block",
  RegisterItemClass: "item",
  RegisterBlockEntityClass: "blockEntity",
  RegisterBlockBehaviorClass: "blockBehavior",
  RegisterCollectibleBehaviorClass: "collectibleBehavior",
  RegisterBlockEntityBehaviorClass: "blockEntityBehavior",
  RegisterEntityBehaviorClass: "entityBehavior",
};

function listCsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listCsFiles(full));
    else if (name.endsWith(".cs")) out.push(full);
  }
  return out;
}

// The clone's checked-out commit, read straight from .git (no `git` binary needed -- keeps every
// script pure Node, per CLAUDE.md). Handles a detached HEAD, a loose ref, and packed-refs.
function headCommit(root: string): string {
  const head = readFileSync(join(root, ".git", "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
  const ref = head.slice(5);
  const loose = join(root, ".git", ref);
  if (existsSync(loose)) return readFileSync(loose, "utf8").trim();
  const packed = readFileSync(join(root, ".git", "packed-refs"), "utf8");
  const line = packed.split("\n").find((l) => l.endsWith(` ${ref}`));
  if (!line) throw new Error(`Can't resolve ${ref} in ${root}/.git`);
  return line.split(" ")[0];
}

function main(): void {
  const root = process.argv[2] ?? "vssurvivalmod";
  const commit = headCommit(root);
  const files = listCsFiles(root).sort();
  const sources = files.map((file) => ({ path: relative(root, file).split(sep).join("/"), text: readFileSync(file, "utf8") }));

  // TypeName -> first declaring file + 1-based line (files sorted, so deterministic; for a
  // `partial class` split over several files this picks the alphabetically-first one).
  const declarations = new Map<string, { path: string; line: number }>();
  const declRe = /\b(?:class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const { path, text } of sources) {
    for (const m of text.matchAll(declRe)) {
      if (declarations.has(m[1])) continue;
      declarations.set(m[1], { path, line: text.slice(0, m.index).split("\n").length });
    }
  }

  const map: CSharpClassMap = { repo: REPO, commit, registrations: {} };
  const regRe = /(Register[A-Za-z]*Class)\(\s*"([^"]+)"\s*,\s*typeof\(\s*([A-Za-z0-9_.]+)\s*\)/g;
  let unresolved = 0;
  for (const { text } of sources) {
    for (const [, method, jsonName, typeName] of text.matchAll(regRe)) {
      const kind = KINDS[method];
      if (!kind) continue;
      const bareType = typeName.split(".").pop()!;
      const decl = declarations.get(bareType);
      if (!decl) unresolved++;
      (map.registrations[kind] ??= {})[jsonName] = { type: bareType, ...(decl ?? {}) };
    }
  }
  // Entity classes (`api.RegisterEntity("EntityBoat", typeof(EntityBoat))`, no "Class" suffix) and AI
  // tasks (`AiTaskRegistry.Register<AiTaskFoo>("foo")`, generic form) don't fit the pattern above.
  const add = (kind: CSharpRegistrationKind, jsonName: string, typeName: string) => {
    const bareType = typeName.split(".").pop()!;
    const decl = declarations.get(bareType);
    if (!decl) unresolved++;
    (map.registrations[kind] ??= {})[jsonName] = { type: bareType, ...(decl ?? {}) };
  };
  for (const { text } of sources) {
    for (const [, jsonName, typeName] of text.matchAll(/RegisterEntity\(\s*"([^"]+)"\s*,\s*typeof\(\s*([A-Za-z0-9_.]+)\s*\)/g)) add("entity", jsonName, typeName);
    for (const [, typeName, jsonName] of text.matchAll(/AiTaskRegistry\.Register<\s*([A-Za-z0-9_.]+)\s*>\(\s*"([^"]+)"/g)) add("aiTask", jsonName, typeName);
  }
  for (const kind of Object.keys(map.registrations) as CSharpRegistrationKind[]) {
    map.registrations[kind] = Object.fromEntries(Object.entries(map.registrations[kind]!).sort(([a], [b]) => a.localeCompare(b)));
  }

  writeFileSync(OUT, JSON.stringify(map, null, 2) + "\n");
  const counts = Object.entries(map.registrations).map(([k, v]) => `${k}: ${Object.keys(v!).length}`);
  console.log(`✔ Wrote ${OUT} from ${REPO}@${commit.slice(0, 10)} (${counts.join(", ")}; ${unresolved} without a found declaration)`);
}

main();
