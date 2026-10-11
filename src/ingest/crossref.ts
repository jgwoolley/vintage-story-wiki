import type { ItemIndexEntry, LootEntry, NormalizedRecipe } from "./types.js";
import type { LangResolver } from "./lang.js";
import { substitutePlaceholders } from "./variantExpander.js";

function key(domain: string, code: string): string {
  return `${domain}:${code}`;
}

function cartesianCombos(groups: Record<string, string[]>): Record<string, string>[] {
  let combos: Record<string, string>[] = [{}];
  for (const [placeholder, values] of Object.entries(groups)) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const value of values) next.push({ ...combo, [placeholder]: value });
    }
    combos = next;
  }
  return combos;
}

export function buildItemIndex(
  recipes: NormalizedRecipe[],
  loot: LootEntry[],
  lang: LangResolver
): Map<string, ItemIndexEntry> {
  const items = new Map<string, ItemIndexEntry>();

  function ensure(domain: string, code: string, kind: "item" | "block", sourceMod: string): ItemIndexEntry {
    const k = key(domain, code);
    let entry = items.get(k);
    if (!entry) {
      const { name, missing } = lang.displayName(kind, domain, code);
      entry = {
        domain,
        code,
        kind,
        displayName: name,
        missingTranslation: missing,
        sourceMod,
        producedBy: [],
        consumedBy: [],
        droppedBy: [],
        appearsInStructures: [],
        spawnDeposits: [],
        spawnBlockPatches: [],
      };
      items.set(k, entry);
    }
    return entry;
  }

  function linkOnce(list: string[], id: string): void {
    if (!list.includes(id)) list.push(id);
  }

  // A concrete, linkable code has neither a bare "*" wildcard nor an unresolved "{placeholder}".
  // (Deliberately not a type predicate: a `false` result doesn't imply `code` isn't a string --
  // e.g. "rock-*" is a string that simply isn't concrete -- so predicate-narrowing would be wrong.)
  const isConcrete = (code: string | undefined): boolean => !!code && !code.includes("*") && !code.includes("{");

  for (const recipe of recipes) {
    const outputKind = recipe.output.type === "block" ? "block" : "item";
    const outputDomain = recipe.output.domain ?? recipe.domain;

    if (recipe.templateVariants) {
      // Recipe-level `allowedVariants: {placeholder: [...]}` -- substitute every combo into the
      // output and every ingredient's code at once (multiple distinct placeholders can coexist).
      for (const combo of cartesianCombos(recipe.templateVariants)) {
        const outCode = recipe.output.code ? substitutePlaceholders(recipe.output.code, combo) : undefined;
        if (isConcrete(outCode)) linkOnce(ensure(outputDomain, outCode!, outputKind, recipe.sourceMod).producedBy, recipe.id);

        for (const ing of recipe.ingredients) {
          if (!ing.code) continue;
          const ingCode = substitutePlaceholders(ing.code, combo);
          if (isConcrete(ingCode)) {
            const ingDomain = ing.domain ?? recipe.domain;
            const ingKind = ing.type === "block" ? "block" : "item";
            linkOnce(ensure(ingDomain, ingCode, ingKind, recipe.sourceMod).consumedBy, recipe.id);
          }
        }
      }
      continue;
    }

    if (isConcrete(recipe.output.code)) {
      ensure(outputDomain, recipe.output.code!, outputKind, recipe.sourceMod).producedBy.push(recipe.id);
    } else if (recipe.output.code && recipe.wildcard) {
      // Output carries an unresolved placeholder (e.g. "plank-{wood}") -- link each concrete
      // variant implied by the recipe's own wildcard ingredient instead of the template string.
      for (const variant of recipe.wildcard.allowedVariants) {
        const concreteCode = substitutePlaceholders(recipe.output.code, { [recipe.wildcard.placeholder]: variant });
        if (isConcrete(concreteCode)) ensure(outputDomain, concreteCode, outputKind, recipe.sourceMod).producedBy.push(recipe.id);
      }
    }

    for (const ing of recipe.ingredients) {
      const ingDomain = ing.domain ?? recipe.domain;
      const ingKind = ing.type === "block" ? "block" : "item";
      if (isConcrete(ing.code)) {
        ensure(ingDomain, ing.code!, ingKind, recipe.sourceMod).consumedBy.push(recipe.id);
      } else if (typeof ing.code === "string" && ing.code.includes("*") && Array.isArray(ing.allowedVariants)) {
        // The wildcard ingredient itself (e.g. "rock-*") -- link each allowed concrete variant.
        for (const variant of ing.allowedVariants) {
          const concreteCode = ing.code.replace("*", variant);
          if (isConcrete(concreteCode)) ensure(ingDomain, concreteCode, ingKind, recipe.sourceMod).consumedBy.push(recipe.id);
        }
      }
    }
  }

  loot.forEach((entry, i) => {
    if (!isConcrete(entry.drop.code)) return;
    const kind = entry.drop.type === "block" ? "block" : "item";
    ensure(entry.drop.domain, entry.drop.code!, kind, entry.sourceMod).droppedBy.push(String(i));
  });

  // appearsInStructures stays empty in v1: schematic BlockCodes inventories are opaque (see plan)
  // until voxel data is decoded in a later phase.

  return items;
}
