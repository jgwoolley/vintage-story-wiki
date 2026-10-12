import type { AssetIndex, CharacterClassGearItem, CharacterClassInfo, TraitInfo, TraitType } from "../types.js";
import type { LangResolver } from "../lang.js";
import { assetsUnderAnyDomain } from "../assetLoader.js";
import { rewriteHandbookLinks, stripGameRichText } from "../codeUtil.js";

interface RawTrait {
  code: string;
  type: TraitType;
  attributes?: Record<string, number>;
}

interface RawGear {
  type?: string;
  code?: string;
}

interface RawClass {
  enabled?: boolean;
  code: string;
  traits?: string[];
  gear?: RawGear[];
}

/**
 * Player traits (`config/traits.json`) -- a flat array, one file total (no variant expansion,
 * no `*ByType` glob keys, unlike almost everything else in this pipeline).
 */
export function extractTraits(index: AssetIndex, lang: LangResolver): TraitInfo[] {
  const out: TraitInfo[] = [];
  for (const asset of assetsUnderAnyDomain(index, "config/traits.json")) {
    const raw = asset.json as RawTrait[];
    for (const t of raw) {
      const rawName = lang.raw(asset.domain, `trait-${t.code}`);
      const rawDesc = lang.raw(asset.domain, `traitdesc-${t.code}`);
      out.push({
        code: t.code,
        domain: asset.domain,
        sourceMod: asset.modid,
        type: t.type,
        // trait-<code> lang values are authored as game-chat rich text (e.g.
        // `<font color="#84ff84">• Soldier </font>`), not web HTML -- strip it down to plain text.
        displayName: rawName ? stripGameRichText(rawName) : t.code,
        // traitdesc-<code>, when present, DOES contain real anchor tags whose href is a
        // handbooksearch:// URI (e.g. "bowyer" links to crafting a bow) -- keep the markup (the
        // template renders this with `| safe`) but rewrite the URI into a real site-relative link.
        description: rawDesc ? rewriteHandbookLinks(rawDesc) : undefined,
        attributes: t.attributes ?? {},
      });
    }
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Player starting classes (`config/characterclasses.json`) -- same single-file, no-variant shape
 * as `extractTraits`. Gear codes are bare item codes (no domain prefix in the source file) --
 * resolved against the class file's own domain, same assumption `extractTrades` makes for its
 * listing codes.
 */
export function extractCharacterClasses(index: AssetIndex, lang: LangResolver): CharacterClassInfo[] {
  const out: CharacterClassInfo[] = [];
  for (const asset of assetsUnderAnyDomain(index, "config/characterclasses.json")) {
    const raw = asset.json as RawClass[];
    for (const c of raw) {
      if (c.enabled === false) continue;
      const gear: CharacterClassGearItem[] = (c.gear ?? [])
        .filter((g): g is RawGear & { code: string } => !!g.code)
        .map((g) => {
          const { name, missing } = lang.displayName("item", asset.domain, g.code);
          return { domain: asset.domain, code: g.code, displayName: name, missingTranslation: missing };
        });
      out.push({
        id: `${asset.domain}:${c.code}`,
        code: c.code,
        domain: asset.domain,
        sourceMod: asset.modid,
        displayName: lang.raw(asset.domain, `characterclass-${c.code}`) ?? c.code,
        traits: c.traits ?? [],
        gear,
      });
    }
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}
