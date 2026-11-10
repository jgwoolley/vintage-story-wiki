import type { AssetIndex, ItemIndexEntry, VariantFamily } from "./types.js";
import { expandVariants, globToRegExp, resolveByType, substitutePlaceholders } from "@nf3t/vs-wiki-core/variantExpander.js";

/**
 * The game's handbook "groupBy": a block/item type can declare `attributes.handbook.groupBy`, a list
 * of code wildcards whose `{placeholder}`s are filled from the variant's own variant values
 * (`armor-{bodypart}-{construction}-*` on `armor-body-lamellar-iron` gives `armor-body-lamellar-*`).
 * Everything matching one wildcard is shown by the game as a single cycling icon
 * (`SlideshowItemstackTextComponent`). The wiki uses the same rule to fold a family of variants
 * into a family on its own `/variants/` pages. `/items/` is not affected: every member keeps its row there.
 *
 * Two entries are in one group when their resolved first pattern (the game keys on `groupBy[0]`) is
 * identical. A group needs at least two entries *in the item index* to exist.
 */
export interface GroupCandidate {
  domain: string;
  code: string;
  /** `groupBy` with placeholders already filled in. */
  patterns: string[];
  /** The variant is matched by one of its type's `creativeinventory` wildcards (the game's own pick of what to list). */
  inCreative: boolean;
}

export type VariantGroup = VariantFamily;

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** True when the type's `creativeinventory` (or `creativeinventoryByType`) lists a wildcard matching `code`. */
function listedInCreative(json: Record<string, unknown>, code: string): boolean {
  const tabs = (resolveByType(json.creativeinventoryByType as Record<string, unknown> | undefined, code) ?? json.creativeinventory) as
    Record<string, unknown> | undefined;
  if (!tabs || typeof tabs !== "object") return false;
  return Object.values(tabs).some((globs) => asStrings(globs).some((g) => globToRegExp(g).test(code)));
}

/** Pure grouping step, separate from the asset walk so it can be tested directly. */
export function buildVariantGroups(candidates: GroupCandidate[], present: ReadonlySet<string>): VariantGroup[] {
  const byKey = new Map<string, GroupCandidate[]>();
  const seen = new Set<string>(); // the same code can be expanded more than once (e.g. by two overlapping type files)
  for (const c of candidates) {
    const id = `${c.domain}:${c.code}`;
    if (!c.patterns.length || !present.has(id) || seen.has(id)) continue;
    seen.add(id);
    const key = `${c.domain}:${c.patterns[0]}`;
    const list = byKey.get(key);
    if (list) list.push(c);
    else byKey.set(key, [c]);
  }
  const groups: VariantGroup[] = [];
  const ids = new Set<string>();
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.code.localeCompare(b.code));
    const primary = list.find((c) => c.inCreative) ?? list[0];
    const base = key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "family";
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    groups.push({ id, key, primary: `${primary.domain}:${primary.code}`, members: list.map((c) => `${c.domain}:${c.code}`) });
  }
  return groups;
}

/** Reads every type's `groupBy`, builds the groups and stamps `variantFamily` (the family id) on the member index entries. */
export function attachHandbookGroups(items: Map<string, ItemIndexEntry>, index: AssetIndex): VariantGroup[] {
  const candidates: GroupCandidate[] = [];
  for (const prefix of ["itemtypes/", "blocktypes/"]) {
    for (const variant of expandVariants(index, [prefix])) {
      const json = variant.json as { attributes?: Record<string, unknown>; attributesByType?: Record<string, Record<string, unknown>> };
      const attrs = { ...(json.attributes ?? {}), ...(resolveByType(json.attributesByType, variant.code) ?? {}) };
      const groupBy = asStrings((attrs.handbook as { groupBy?: unknown } | undefined)?.groupBy);
      if (!groupBy.length) continue;
      candidates.push({
        domain: variant.domain,
        code: variant.code,
        patterns: groupBy.map((p) => substitutePlaceholders(p, variant.groupValues)),
        inCreative: listedInCreative(variant.json as Record<string, unknown>, variant.code),
      });
    }
  }
  const groups = buildVariantGroups(candidates, new Set(items.keys()));
  for (const g of groups) {
    for (const id of g.members) items.get(id)!.variantFamily = g.id;
  }
  return groups;
}
