# How `skipVariants` works

`skipVariants` is a field in Vintage Story's JSON asset files that removes specific variants from
the set of things a definition generates. This note covers what it means in the game data, how this
project's ingest handles it, and where it isn't handled yet.

Everything about the game's own behavior here is inferred from the asset files. The engine that
actually loads them is closed source, and the `vssurvivalmod` clone doesn't contain the loader. The
ingest side is read from `src/ingest/variantExpander.ts`.

## Background: variant groups

One item, block or entity file usually describes many things. The file declares
`variantgroups`, and the game builds every combination of their states. From
`itemtypes/tool/spear.json`:

```json5
code: "spear",
variantgroups: [
  { code: "type",     states: ["generic", "scrap", "boar", "voulge", "fork", "ranseur"] },
  { code: "material", states: ["chert", "flint", "copper", ..., "ruined", "steel"] }
]
```

That's 6 × 20 = 120 combinations, named `spear-<type>-<material>`: `spear-generic-copper`,
`spear-boar-ruined`, `spear-fork-steel`, and so on. Most combinations don't exist in the game
(there's no `spear-fork-steel`), so a file needs a way to trim the cross product.

## The two trimming fields

| Field | Meaning |
|---|---|
| `allowedVariants` | Whitelist: only codes matching an entry are generated. |
| `skipVariants` | Blacklist: codes matching an entry are removed. |

The spear file uses both:

```json5
skipVariants: [
  "spear-generic-ruined",
  "spear-generic-scrap"
],
allowedVariants: [
  "spear-generic-*",
  "spear-scrap-scrap",
  "spear-boar-ruined",
  ...
]
```

Read it as: keep every `spear-generic-*`, plus a few named specials, but drop `spear-generic-ruined` and
`spear-generic-scrap`. A variant must pass the allow list (if there is one) and not match the skip
list. `skipVariants` wins when both match.

Usually only one of the two is present. A file with a mostly-valid cross product and a few
exceptions uses `skipVariants` alone. Examples:
- `boatconstruction`: skips `boatconstruction-sailed-aged`.
- `mushroom`: skips `mushroom-beardedtooth-*`, `mushroom-whiteoyster-*` and `mushroom-pinkoyster-*`.
- A coral block: skips `*-dead-2`.

## Pattern syntax

Each entry is matched against the **whole concrete variant code**, not a single group's state:

- A literal code matches exactly: `"knife-generic-ruined"`.
- `*` matches any run of characters: `"mushroom-pinkoyster-*"`, `"*-dead-2"`.
- A leading `@` means the rest is a regular expression, anchored at both ends.

These are the same rules as the `...ByType` maps (`durabilityByType`, `dropsByType`, ...).
`globToRegExp` in `variantExpander.ts` implements all of them.

## Where it appears

In the vanilla and BetterRuins data, `skipVariants` shows up in 19 `itemtypes` files, 42
`blocktypes` files, 2 `entities` files and 27 `recipes` files. It takes **two different shapes**.

### 1. Array of codes (`itemtypes`, `blocktypes`, `entities`)

The form above. It filters the variants of the definition it sits in.

### 2. Object of placeholder → values (`recipes`)

A recipe can use placeholders in its ingredients and output (`nugget-{ore}`), listing the values in
`allowedVariants`. Its `skipVariants` is then an object keyed by placeholder, naming the values to
leave out:

```json5
skipVariants: {
  ore: ["galena_nativesilver", "quartz_nativesilver", "quartz_nativegold"]
},
output: { type: "item", code: "nugget-{ore}", quantity: 1 }
```

This means "make this recipe for every `ore` value except these three". It excludes by *value of one
group*, not by whole code.

## How this project handles it

`expandVariants` (`src/ingest/variantExpander.ts`) turns each item/block/entity definition into
concrete variants. For each cartesian combination it builds the code, then:

```ts
if (allowList && !allowList.some((re) => re.test(code))) continue; // not whitelisted
if (skipList  &&  skipList.some((re) => re.test(code))) continue;  // blacklisted
```

Both lists are compiled with `globToRegExp`, so `*` and `@regex` entries work.

### History: this used to be broken

Until the weapon/tool table was added, the allow list was compared with exact set membership
(`allowList.has(code)`) and `skipVariants` was ignored entirely. Consequences:

- **Globbed allow entries matched nothing.** `"spear-generic-*"` never equalled a real code, so every
  metal spear (`spear-generic-copper`, `...-steel`) silently disappeared. Same for knives, blades,
  some fish and some animals.
- **Skipped variants were generated anyway** whenever there was no allow list to hide them, producing
  items that don't exist in the game (for example the `*-snow` brick-slab variants).

Fixing both changed the generated data: roughly +126 items, +148 creatures and +59 gear entries, with the
nonexistent snow slabs gone, and recipes unchanged.

## Known gap: recipe `skipVariants`

The object form in recipes is **not honored yet**. The cross-reference step
(`crossref.ts`, via `cartesianCombos(recipe.templateVariants)`) expands every `allowedVariants`
combination without removing the skipped values. A recipe that skips `quartz_nativegold` will
still link a nonexistent `nugget-quartz_nativegold` as one of its outputs.

Fixing it means subtracting `recipe.raw.skipVariants[placeholder]` from each placeholder's value list before
taking the cartesian product. Nobody has done that or measured how many items it would change. The
wiki may therefore list a few items as craftable that aren't.

## Checking a definition by hand

To see what a file really generates, run the expander for it and look at the codes:

```ts
import { expandVariants } from "./src/ingest/variantExpander.js";
// index = loaded asset index (see src/ingest/index.ts)
expandVariants(index, ["itemtypes/tool/spear.json"]).map((v) => v.code);
```

Every concrete `domain:code` the ingest produced is also in `site/_data/generated/items.json`.
