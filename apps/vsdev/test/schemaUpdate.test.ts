// The working folder's vs-manifest.schema.json is refreshed by every command, unless --no-schema-update is given.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/main.js";
import { bundledManifestSchema, SCHEMA_FILE, SOURCE_SCHEMA, updateManifestSchema } from "../src/schemaUpdate.js";

const ID = "https://github.com/jgwoolley/vintage-story-wiki/vs-manifest.schema.json";

/** A scratch folder, a "bundled" schema in it, and a project folder to run in; runs `body`, then cleans up. */
async function withProject(body: (ctx: { dir: string; bundled: string; target: string }) => Promise<void> | void) {
  const root = mkdtempSync(path.join(tmpdir(), "vsdev-schema-"));
  const dir = path.join(root, "project");
  mkdirSync(dir);
  const bundled = path.join(root, "bundled.schema.json");
  writeFileSync(bundled, JSON.stringify({ $id: ID, properties: { a: {}, b: {} } }, null, 2));
  const saved = { cwd: process.env.INIT_CWD, log: console.log, error: console.error };
  process.env.INIT_CWD = dir;
  try {
    await body({ dir, bundled, target: path.join(dir, SCHEMA_FILE) });
  } finally {
    if (saved.cwd === undefined) delete process.env.INIT_CWD;
    else process.env.INIT_CWD = saved.cwd;
    console.log = saved.log;
    console.error = saved.error;
    rmSync(root, { recursive: true, force: true });
  }
}

test("updateManifestSchema: rewrites an out-of-date copy, leaves a current one, never creates one", () => withProject(({ dir, bundled, target }) => {
  assert.equal(updateManifestSchema(dir, bundled), "absent");
  assert.throws(() => readFileSync(target), /ENOENT/);

  writeFileSync(target, JSON.stringify({ $id: ID, properties: { a: {} } }));
  assert.equal(updateManifestSchema(dir, bundled), "updated");
  assert.equal(readFileSync(target, "utf8"), readFileSync(bundled, "utf8"));

  // Same content, other formatting: not rewritten (the user's layout stays).
  const compact = JSON.stringify({ $id: ID, properties: { a: {}, b: {} } });
  writeFileSync(target, compact);
  assert.equal(updateManifestSchema(dir, bundled), "current");
  assert.equal(readFileSync(target, "utf8"), compact);
}));

test("updateManifestSchema: a file that isn't our schema is left alone", () => withProject(({ dir, bundled, target }) => {
  writeFileSync(target, JSON.stringify({ $id: "https://example.com/other.json" }));
  assert.equal(updateManifestSchema(dir, bundled), "skipped");
  writeFileSync(target, "not json");
  assert.equal(updateManifestSchema(dir, bundled), "skipped");
  assert.equal(readFileSync(target, "utf8"), "not json");
  assert.equal(updateManifestSchema(dir, path.join(dir, "no-such-bundled.json")), "skipped");
}));

test("the shipped schema is the one in src/, and the skills' copies of it match", () => {
  assert.equal(bundledManifestSchema(), SOURCE_SCHEMA);
  const source = JSON.parse(readFileSync(SOURCE_SCHEMA, "utf8")) as { $id: string };
  assert.equal(source.$id, ID);
  const repo = path.resolve(import.meta.dirname, "..", "..", "..");
  assert.equal(existsSync(path.join(repo, SCHEMA_FILE)), false, "no second copy at the repo root: edit src/vs-manifest.schema.json");
  for (const skill of readdirSync(path.join(repo, "skills"))) {
    const copy = path.join(repo, "skills", skill, SCHEMA_FILE);
    if (existsSync(copy)) assert.deepEqual(JSON.parse(readFileSync(copy, "utf8")), source, `skills/${skill}/${SCHEMA_FILE} is out of date: cp it from src/`);
  }
});

test("updateManifestSchema: a symlinked copy is updated through the link", () => withProject(({ dir, bundled, target }) => {
  const real = path.join(dir, "real.json");
  writeFileSync(real, JSON.stringify({ $id: ID, properties: {} }));
  symlinkSync(real, target);
  assert.equal(updateManifestSchema(dir, bundled), "updated");
  assert.equal(readFileSync(real, "utf8"), readFileSync(bundled, "utf8"));
}));

test("vsdev <command> refreshes the folder's schema and says so; --no-schema-update (anywhere) and --help don't", () => withProject(async ({ dir, target }) => {
  const stale = JSON.stringify({ $id: ID, properties: {} });
  const run = async (...argv: string[]) => {
    const errors: string[] = [];
    console.log = () => {};
    console.error = (...a: unknown[]) => void errors.push(a.join(" "));
    const code = await main(argv);
    return { code, errors: errors.join("\n") };
  };
  writeFileSync(target, stale);
  const skip = await run("paths", "--no-schema-update");
  assert.equal(skip.code, 0);
  assert.equal(readFileSync(target, "utf8"), stale);
  assert.doesNotMatch(skip.errors, /schema/);
  await run("--no-schema-update", "paths");
  assert.equal(readFileSync(target, "utf8"), stale);
  await run("paths", "--help");
  assert.equal(readFileSync(target, "utf8"), stale);

  const first = await run("paths");
  assert.equal(first.code, 0);
  assert.notEqual(readFileSync(target, "utf8"), stale);
  assert.match(first.errors, /updated vs-manifest\.schema\.json/);
  assert.match(first.errors, /--no-schema-update/);
  const second = await run("paths");
  assert.doesNotMatch(second.errors, /updated/);
  void dir;
}));
