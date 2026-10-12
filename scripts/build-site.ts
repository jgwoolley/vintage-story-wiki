#!/usr/bin/env -S npx tsx
// Thin wrapper around the Eleventy CLI that measures the site build's own wall-clock duration.
//
// Why a wrapper at all: Eleventy has no point in its own lifecycle where it both (a) knows its
// total run time and (b) can still write that number into the HTML it's producing -- by the time
// an `eleventy.after` event fires with the real duration, every template (including this site's
// own `/<lang>/build/` page, which wants to *display* that duration) has already rendered. There
// is no way for Eleventy to self-report synchronously.
//
// Resolution picked here: run `eleventy` as a child process, time the whole invocation from
// outside it, and write the result to `site/_data/generated/eleventyBuildTiming.json` only AFTER
// the child exits. Eleventy's automatic `_data` cascade means that file shows up as
// `generated.eleventyBuildTiming` on every page -- but necessarily one full build run late: the
// number `/<lang>/build/` renders describes the *previous* successful `npm run build`, not the
// run that produced the page currently being viewed. `site/build/index.njk` labels it that way
// explicitly rather than presenting it as a live self-measurement.
//
// (The alternative considered -- an `eleventy.after` hook writing the same sidecar file, read by
// a few lines of client-side JS on page load -- has the exact same one-run staleness, just moved
// from "stale when the page is generated" to "stale when the page is loaded in a browser". This
// version keeps the number server-rendered, with the staleness called out in one place instead of
// needing a fetch() on every page view.)
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EleventyBuildTiming } from "../src/ingest/types.js";

const OUT_DIR = "site/_data/generated";
const ELEVENTY_BIN = join("node_modules", ".bin", "eleventy");

const startedAt = Date.now();
// Any args this script itself receives (e.g. `--serve`) are forwarded as-is to the real Eleventy
// CLI; `stdio: "inherit"` keeps Eleventy's own console output visible exactly as if it had been
// invoked directly, and env is inherited by default so PATH_PREFIX/SITE_URL (set by CI) still
// reach it.
const result = spawnSync(ELEVENTY_BIN, process.argv.slice(2), { stdio: "inherit" });
const durationMs = Date.now() - startedAt;

const timing: EleventyBuildTiming = {
  durationMs,
  finishedAtIso: new Date().toISOString(),
  succeeded: result.status === 0,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "eleventyBuildTiming.json"), JSON.stringify(timing, null, 2));

if (result.error) {
  console.error(`✘ Failed to launch Eleventy: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
