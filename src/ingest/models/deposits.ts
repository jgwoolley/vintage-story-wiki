import type { AssetIndex, DepositInfo } from "../types.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";

function bareRock(code: string): string {
  return code.startsWith("rock-") ? code.slice(5) : code;
}

/**
 * Ore/gem/rock deposits (`worldgen/deposits/**`) describe which rock type(s) host a given
 * mineral, and at which grades -- e.g. chromite only occurs as "poor"/"medium" in andesite but up
 * to "bountiful" in kimberlite. Also recovers the concrete item/block codes each deposit can
 * actually produce, by substituting each host rock (+ grade, when the deposit has one) into its
 * `placeblock`/`surfaceBlock` code templates -- the same "ore-{grade}-{mineral}-{rock}" shape
 * confirmed in `models/decor.ts`'s sibling investigation of `ore-graded.json`.
 */
export function extractDeposits(index: AssetIndex): { deposits: DepositInfo[]; codeToDepositIds: Map<string, string[]> } {
  const deposits: DepositInfo[] = [];
  const codeToDepositIds = new Map<string, string[]>();

  for (const asset of assetsUnderAnyDomain(index, "worldgen/deposits/")) {
    const segments = asset.relPath.split("/"); // ["worldgen","deposits","metalore","chromite.json"] or ["worldgen","deposits","coal.json"]
    const category = segments.length > 3 ? segments[2] : "other";
    const entries = Array.isArray(asset.json) ? (asset.json as any[]) : [asset.json as any];

    entries.forEach((entry, i) => {
      const attrs = entry?.attributes;
      if (!entry?.code || !attrs?.inblock?.code || !attrs?.placeblock?.code) return;

      const inblockCode: string = attrs.inblock.code;
      const hostRocks: string[] = inblockCode.includes("*") ? attrs.inblock.allowedVariants ?? [] : [bareRock(inblockCode)];
      if (hostRocks.length === 0) return;

      let gradesByRock: Record<string, string[]> | undefined;
      if (attrs.placeblock.allowedVariantsByInBlock) {
        gradesByRock = {};
        for (const [rockKey, grades] of Object.entries(attrs.placeblock.allowedVariantsByInBlock as Record<string, string[]>)) {
          gradesByRock[bareRock(rockKey)] = grades;
        }
      }

      const deposit: DepositInfo = {
        id: `${asset.domain}:deposit/${category}/${entry.code}#${i}`,
        code: entry.code,
        domain: asset.domain,
        sourceMod: asset.modid,
        category,
        hostRocks,
        gradesByRock,
        generator: entry.generator,
        triesPerChunk: entry.triesPerChunk,
        yPosRel: attrs.yPosRel ? { avg: attrs.yPosRel.avg, var: attrs.yPosRel.var } : undefined,
      };
      deposits.push(deposit);

      const templates = [attrs.placeblock.code, attrs.surfaceBlock?.code].filter(Boolean) as string[];
      for (const rock of hostRocks) {
        const grades = gradesByRock?.[rock] ?? [undefined];
        for (const grade of grades) {
          for (const template of templates) {
            let concrete = template.replace("{rock}", rock);
            if (grade !== undefined) concrete = concrete.replace("*", grade);
            else if (concrete.includes("*")) continue; // can't resolve a grade-less template with a wildcard -- skip rather than guess
            const key = `${asset.domain}:${concrete}`;
            const list = codeToDepositIds.get(key) ?? [];
            list.push(deposit.id);
            codeToDepositIds.set(key, list);
          }
        }
      }
    });
  }

  return { deposits, codeToDepositIds };
}
