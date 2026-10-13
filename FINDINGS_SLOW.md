# Findings: why the ingest took 21m 42s

Source: the GitHub Actions pipeline timings on `/en/build/` (2026-10-13). Download took 10.6s. Ingest took 21m 42s. The Eleventy build was not reported (see the last section).

## Where the time went

Two ingest steps accounted for about 20 of the 21m 42s:

| Step | Took |
|---|---|
| Resolving tapestry/wallcarving instances in worldgen schematics | 4m 27s |
| Resolving clutter types (ShapeFromAttributes) in worldgen schematics | 15m 51s |

Both steps (`src/ingest/models/tapestryInstances.ts` and `clutterInstances.ts`) decode every block entity in each worldgen schematic that contains a relevant block. They do this with `decodeBlockEntity` from `site/assets/schematicDecode.js`.

## How it was diagnosed

I profiled the pieces separately on the local `vs_server/` and `.scratch/` data.

- Reading headers and `JSON.parse` of the schematics cost under 1s in total, so file I/O wasn't the problem.
- Decoding all vanilla schematics took about 12s.
- Decoding the BetterRuins mod schematics took 491s, and a few files took 15–75s each.
- Inside one slow file (`mediumruins-sirayne-o5-tradershelter.json`, 365 entities), every `microblock` (chiseled block) entity took about 4s. Everything else was well under a millisecond.

## Root cause

`TreeAttributeParser.readAttribute` trusted length fields read from the data. For type 11 (int array), `len` is a raw int32. When the parser was misaligned or the data was malformed, `len` was huge. The loop `for (i < len)` kept iterating to about 2^31 even after the buffer was exhausted, because the bounds check only skipped the push and never ended the loop.

The type 10 (string array) and type 12 (long array) cases had the same pattern. They used `Array.from({length: len})` with an unclamped length.

## Fix

In `site/assets/schematicDecode.js`, the three array cases now clamp `len` to the bytes remaining. The int-array loop also stops as soon as the buffer is exhausted. Decoded `blockCode` and `type` values are unchanged. Only malformed input behaves differently.

Results:

- BetterRuins decode time went from 491s to 1.2s.
- `npm run typecheck` passes.
- I didn't re-run a full `npm run ingest`, so the end-to-end number is still unconfirmed.

The decoder is shared with the browser schematic viewer, so the viewer gets the same protection.

## Remaining ingest costs

These are minor compared with the fix above.

- Loading assets (JSON5): 26.1s
- Extracting loot: 24.0s
- Extracting block display names (schematic viewer legend): 25.7s
- Vanilla decode throws on non-tapestry entities (about 3ms per exception). That's only about 12s in total and was left as is.

## "Not available" for Eleventy build time

This is expected behavior, not a bug. `site/_data/generated/` is gitignored, and nothing carries `eleventyBuildTiming.json` between CI runs. The deployed page therefore never has a previous build's number to show. Fixing it would mean caching or restoring that file in the workflow. It has not been done.
