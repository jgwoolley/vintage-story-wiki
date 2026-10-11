# About this wiki

This is a reference for Vintage Story crafting recipes, drop rates, generated structures,
decor/clothing, books, and where things naturally spawn in the world. Unlike a hand-edited wiki,
every page here is generated straight from the game's own data files, so it stays in sync with
whatever version of the game (and mods) it was built against — but it also means it only knows
what's actually in those files, nothing more.

## How to use it

- **Items & Blocks** — look up any item or block to see what recipes produce it, what it's used
  in, what drops it, and (for things like ore or wild crops) where it naturally occurs.
- **Recipes** — browse by category (grid crafting, smithing, cooking, etc.), or jump to one from
  an item's page.
- **Loot & Drops** — per-creature/block drop tables, plus (for creatures) health, size, and the
  conditions needed for them to spawn at all.
- **Structures** — world-generated buildings and ruins, with their spawn conditions explained in
  plain language.
- **Spawn Locations** — a combined list of every ore/gem/rock deposit and wild crop/flower/etc.
  spawn rule. Click through from here, or from any individual item's page.
- **Decor & Clothing** — paintings, tapestries, and clothing, including their flavor text where
  the game has any, and which structures you can find them in.
- **Books & Lore** — the full readable text of every in-game book and journal.
- **Mods** — which mods (beyond vanilla) this build includes.

Every table has a search box, and most have a filter dropdown too — both are saved in the page URL,
so you can bookmark or share a filtered view. Click a code like `tallgrass-*` or a creature tag
almost anywhere and it'll jump you straight to a pre-filtered list.

## A few things worth knowing

- **Spawn/climate numbers are the rule the game checks, not a promise.** A creature or deposit
  listed as needing, say, a temperature between 5–20°C and "near the surface" depth is describing
  the condition the game tests per chunk or per attempt — not a guarantee you'll find one in any
  specific spot that meets those numbers, and not a claim it's *impossible* slightly outside them.
- **No icons.** This wiki is text-only. It isn't an oversight — the data this site is built from
  genuinely doesn't include item/block artwork (that's a separate, access-gated download), and
  Vintage Story generates its inventory icons from full 3D models at render time rather than using
  flat image files, so there's no icon asset to simply copy over.
- **Not everything in the game has a page here.** Pages are built from recipes, drop tables, and
  (separately) a few registries — like paintings, decor, ore, and wild crops — that have neither.
  A small number of other items that the game itself marks as "not for the in-game handbook" may
  still be missing. If something's absent, that's more likely than not the reason.
- **Mods with their own compiled code** (shown as such on the Mods page) can add behavior this
  wiki simply can't see, since it only reads JSON data, not code.

This page is deliberately short. For exactly how the data is extracted, the project's `README.md`
in its source repository has the full technical writeup.
