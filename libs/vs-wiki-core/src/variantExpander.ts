import type { AssetIndex, LoadedAsset } from "./types.js";

interface VariantGroup {
  code: string;
  states?: string[];
  loadFromProperties?: string; // e.g. "block/wood" -> assets/<domain>/worldproperties/block/wood.json
}

export interface ConcreteVariant {
  domain: string;
  sourceModid: string;
  code: string; // fully-resolved, e.g. "woodenfencegate-aged-n-opened-left-free"
  baseCode: string; // the definition file's own `code`, e.g. "woodenfencegate"
  groupValues: Record<string, string>; // e.g. { wood: "aged", type: "n", ... }
  json: Record<string, unknown>; // original definition JSON, unresolved
  sourceFile: string;
}

export function globToRegExp(pattern: string): RegExp {
  if (pattern.startsWith("@")) return new RegExp(`^${pattern.slice(1)}$`);
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function worldPropertyStates(index: AssetIndex, domain: string, propPath: string): string[] {
  // propPath is like "block/wood" -- try the variant's own domain first, then vanilla survival as fallback.
  for (const d of [domain, "survival", "game"]) {
    const asset = index.get(`${d}:worldproperties/${propPath}.json`);
    if (!asset) continue;
    const json = asset.json as { variants?: Record<string, unknown>[] };
    if (!Array.isArray(json.variants)) continue;
    return json.variants
      .map((v) => (v.Code ?? v.code) as string | undefined)
      .filter((v): v is string => typeof v === "string");
  }
  return [];
}

function resolveGroupStates(index: AssetIndex, domain: string, group: VariantGroup): string[] {
  const inline = group.states ?? [];
  const fromProps = group.loadFromProperties ? worldPropertyStates(index, domain, group.loadFromProperties) : [];
  return [...new Set([...inline, ...fromProps])];
}

function cartesian(groups: { code: string; states: string[] }[]): Record<string, string>[] {
  let combos: Record<string, string>[] = [{}];
  for (const group of groups) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const state of group.states) {
        next.push({ ...combo, [group.code]: state });
      }
    }
    combos = next;
  }
  return combos;
}

/** Expands every blocktype/itemtype/entity asset under the given category prefixes into concrete variants. */
export function expandVariants(index: AssetIndex, categoryPrefixes: string[]): ConcreteVariant[] {
  const out: ConcreteVariant[] = [];

  for (const asset of index.values()) {
    if (!categoryPrefixes.some((p) => asset.relPath.startsWith(p))) continue;
    const json = asset.json as Record<string, unknown>;
    const baseCode = String(json.code ?? "");
    if (!baseCode) continue;

    const groups = (json.variantgroups as VariantGroup[] | undefined) ?? [];
    if (groups.length === 0) {
      out.push({
        domain: asset.domain,
        sourceModid: asset.modid,
        code: baseCode,
        baseCode,
        groupValues: {},
        json,
        sourceFile: asset.sourceFile,
      });
      continue;
    }

    // A top-level `allowedVariants: [...]` (distinct from the per-ingredient recipe mechanism)
    // is an explicit allow-list restricting which combinations of the variantgroups cartesian
    // product actually exist (e.g. not every ore mineral occurs in every rock type) -- confirmed
    // against real game data (ore-graded.json, fishraw.json) where the full cross product wildly
    // over-generates nonexistent items/blocks. When present, only codes in this list are kept.
    // Entries may be globs ("spear-generic-*"), so match with globToRegExp rather than exact set
    // membership; `skipVariants` is the inverse list and is honored the same way.
    const toMatchers = (list: unknown) => (Array.isArray(list) ? (list as string[]).map(globToRegExp) : undefined);
    const allowList = toMatchers(json.allowedVariants);
    const skipList = toMatchers(json.skipVariants);

    const resolvedGroups = groups.map((g) => ({ code: g.code, states: resolveGroupStates(index, asset.domain, g) }));
    for (const combo of cartesian(resolvedGroups)) {
      const suffix = groups.map((g) => combo[g.code]).join("-");
      const code = suffix ? `${baseCode}-${suffix}` : baseCode;
      if (allowList && !allowList.some((re) => re.test(code))) continue;
      if (skipList && skipList.some((re) => re.test(code))) continue;
      out.push({
        domain: asset.domain,
        sourceModid: asset.modid,
        code,
        baseCode,
        groupValues: combo,
        json,
        sourceFile: asset.sourceFile,
      });
    }
  }

  return out;
}

/**
 * Resolves a `<field>ByType` map (e.g. dropsByType, attributesByType) for one concrete variant's
 * full code, matching glob (`*`) or raw-regex (`@...`) keys. When several keys match, the most
 * specific one wins (pattern length as a proxy for literal-character count, so e.g.
 * "*-polar-adult-male" beats the more generic "*-male" for the same code) -- object order is
 * NOT a reliable specificity signal (confirmed against real data: bear-adult.json lists the
 * generic "*-male"/"*-female" entries after the more specific per-type ones).
 */
export function resolveByType<T>(byType: Record<string, T> | undefined, concreteCode: string): T | undefined {
  if (!byType) return undefined;
  let best: { pattern: string; value: T } | undefined;
  for (const [pattern, value] of Object.entries(byType)) {
    if (!globToRegExp(pattern).test(concreteCode)) continue;
    if (!best || pattern.length >= best.pattern.length) best = { pattern, value };
  }
  return best?.value;
}

/** Substitutes {groupcode} placeholders (e.g. "{metal}", "{wood}") using resolved group values. */
export function substitutePlaceholders(template: string, groupValues: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => groupValues[key] ?? match);
}
