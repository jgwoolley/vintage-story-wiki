import type { AssetIndex, LootEntry } from "../types.js";
import { expandVariants, resolveByType, substitutePlaceholders } from "../variantExpander.js";
import { splitDomainCode } from "../codeUtil.js";

interface DropSpec {
  type?: string;
  code?: string;
  quantity?: { avg?: number; var?: number };
  chance?: { avg?: number; var?: number };
  manMade?: boolean;
  dropModbyStat?: string;
}

function toLootDrop(spec: DropSpec, fallbackDomain: string, groupValues: Record<string, string>) {
  const rawCode = substitutePlaceholders(spec.code ?? "", groupValues);
  const { domain, bareCode } = splitDomainCode(rawCode, fallbackDomain);
  return {
    type: spec.type,
    domain,
    code: bareCode,
    quantityAvg: spec.quantity?.avg,
    quantityVar: spec.quantity?.var,
    chanceAvg: spec.chance?.avg,
    chanceVar: spec.chance?.var,
    manMade: spec.manMade,
    dropModbyStat: spec.dropModbyStat,
  };
}

export function extractLoot(index: AssetIndex): LootEntry[] {
  const out: LootEntry[] = [];

  // --- Block drops + panning drops ---
  const blockVariants = expandVariants(index, ["blocktypes/"]);
  for (const variant of blockVariants) {
    const json = variant.json as any;
    const drops: DropSpec[] = resolveByType(json.dropsByType, variant.code) ?? json.drops ?? [];
    for (const drop of drops) {
      if (!drop?.code) continue;
      out.push({
        sourceKind: "block",
        sourceDomain: variant.domain,
        sourceCode: variant.code,
        sourceMod: variant.sourceModid,
        mechanism: "blockDrop",
        drop: toLootDrop(drop, variant.domain, variant.groupValues),
      });
    }

    const panningDrops = json.attributes?.panningDrops as Record<string, DropSpec[]> | undefined;
    if (panningDrops) {
      for (const [pattern, entries] of Object.entries(panningDrops)) {
        for (const drop of entries) {
          if (!drop?.code) continue;
          out.push({
            sourceKind: "block",
            sourceDomain: variant.domain,
            sourceCode: variant.code,
            sourceMod: variant.sourceModid,
            mechanism: "panning",
            panningKeyPattern: pattern,
            drop: toLootDrop(drop, variant.domain, variant.groupValues),
          });
        }
      }
    }
  }

  // --- Entity drops (death drops + harvestable behavior) ---
  const entityVariants = expandVariants(index, ["entities/"]);
  for (const variant of entityVariants) {
    const json = variant.json as any;

    const deathDrops: DropSpec[] = json.drops ?? [];
    for (const drop of deathDrops) {
      if (!drop?.code) continue;
      out.push({
        sourceKind: "entity",
        sourceDomain: variant.domain,
        sourceCode: variant.code,
        sourceMod: variant.sourceModid,
        mechanism: "entityDrop",
        drop: toLootDrop(drop, variant.domain, variant.groupValues),
      });
    }

    const behaviors: any[] = json.server?.behaviors ?? [];
    const harvestable = behaviors.find(
      (b) => String(b?.code ?? b?.name ?? "").toLowerCase() === "harvestable"
    );
    const harvestDrops: DropSpec[] = harvestable?.drops ?? [];
    for (const drop of harvestDrops) {
      if (!drop?.code) continue;
      out.push({
        sourceKind: "entity",
        sourceDomain: variant.domain,
        sourceCode: variant.code,
        sourceMod: variant.sourceModid,
        mechanism: "harvestable",
        drop: toLootDrop(drop, variant.domain, variant.groupValues),
      });
    }
  }

  return out;
}
