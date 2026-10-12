import type { AssetIndex, DialogueReward, NpcDialogue } from "../types.js";
import type { LangResolver } from "../lang.js";
import { expandVariants, resolveByType } from "../variantExpander.js";
import { resolveLangRef, rewriteHandbookLinks, splitDomainCode } from "../codeUtil.js";
import { hasHealthBehavior } from "./loot.js";

interface RawDialogueTextLine {
  value?: string;
  jumpTo?: string;
  condition?: unknown;
  conditions?: unknown;
}

interface RawDialogueComponent {
  code?: string;
  owner?: string; // "player" for the player's own response lines; anything else (a role name like "trader"/"villager", or the NPC's own name) is the NPC's side
  type?: string;
  text?: RawDialogueTextLine[];
  trigger?: string;
  triggerdata?: { type?: string; code?: string; stacksize?: number };
}

interface RawDialogueFile {
  components?: RawDialogueComponent[];
}

interface ParsedDialogueFile {
  lines: string[];
  rewards: DialogueReward[];
}

/** A `conversable` behavior entry's actual `dialogue`/`dialogueByType` config, however it's
 * declared -- either inline on a `client.behaviors`/`server.behaviors` array entry
 * (`{code: "conversable", dialogue: "..."}`/`{..., dialogueByType: {...}}`, used by
 * trader-{male,female}/skeletonarm/skeletonwithloot/libraryresonator), or nested under a
 * top-level `behaviorConfigs.conversable` object instead (used by villager.json). Both shapes are
 * real, confirmed against vanilla entity data, and neither predicts the other -- villager.json
 * additionally has a *bare* `{code: "conversable"}` placeholder in its `server.behaviors` array
 * (confirmed real, a genuine trap: naively checking the behaviors array first finds this and
 * wrongly treats the entity as having no dialogue, since the placeholder itself carries neither
 * field) with the real config living only in `behaviorConfigs.conversable` alongside it -- so
 * `behaviorConfigs` is checked first, and a behaviors-array entry is only used as a fallback, and
 * only once confirmed to actually carry one of the two fields itself. */
function findConversableConfig(json: any): { dialogue?: string; dialogueByType?: Record<string, string> } | undefined {
  const behaviors: any[] = [...(json.client?.behaviors ?? []), ...(json.server?.behaviors ?? [])];
  const candidates = [json.behaviorConfigs?.conversable, ...behaviors.filter((b) => String(b?.code ?? "").toLowerCase() === "conversable")];
  return candidates.find((c) => c && (c.dialogue || c.dialogueByType));
}

/**
 * Parses one `config/dialogue/<name>.json` file's `components` array into the two flat facts a
 * wiki page can use: every NPC-side line (components whose `owner` isn't "player" -- the player's
 * own response options aren't "this NPC's dialogue"), and every item handed over via a
 * `giveitemstack` trigger (the only reward-shaped trigger among the ones actually observed:
 * attack/closedialogue/giveitemstack/openhairstyling/opentrade/playanimation/repairheldarmor/
 * repairheldtool/revealname/spawnentity/takefrominventory/unlockdoor -- `takefrominventory` is the
 * mirror-image "player pays the NPC" case and isn't a reward). Line text is lang-resolved the same
 * way lore/guide text is (a `dialogue-<key>` lang key, or -- just as often here -- literal inline
 * English text with no lang key at all; `resolveLangRef`'s raw-lookup-with-literal-fallback
 * handles both), then has any embedded `handbook://`/`handbooksearch://` links rewritten the same
 * way guide text does (none actually occur in the vanilla dialogue lang strings as of this
 * writing, but the mechanism is identical so it's reused rather than skipped). This is
 * deliberately NOT a full decode of the branching state machine (conditions, jumpTo targets,
 * setVariables, every other trigger type) -- two flat lists is what's actually useful here.
 */
function parseDialogueFile(json: RawDialogueFile, domain: string, lang: LangResolver): ParsedDialogueFile {
  const lines: string[] = [];
  const rewards: DialogueReward[] = [];

  for (const comp of json.components ?? []) {
    if (comp.owner !== "player" && Array.isArray(comp.text)) {
      for (const t of comp.text) {
        if (!t?.value) continue;
        const resolved = rewriteHandbookLinks(resolveLangRef(lang, domain, t.value));
        if (!lines.includes(resolved)) lines.push(resolved);
      }
    }

    if (comp.trigger === "giveitemstack" && comp.triggerdata?.code) {
      const { domain: rewardDomain, bareCode } = splitDomainCode(comp.triggerdata.code, domain);
      const reward: DialogueReward = {
        domain: rewardDomain,
        code: bareCode,
        kind: comp.triggerdata.type === "block" ? "block" : "item",
        stacksize: comp.triggerdata.stacksize,
      };
      const isDupe = rewards.some((r) => r.domain === reward.domain && r.code === reward.code && r.stacksize === reward.stacksize);
      if (!isDupe) rewards.push(reward);
    }
  }

  return { lines, rewards };
}

/**
 * NPC dialogue trees (`config/dialogue/<name>.json`) -- previously explicitly out of scope (see
 * `models/trades.ts`'s old doc comment). Vanilla ships 24 dialogue files, not just `trader.json`:
 * one generic `trader`/`treasurehunter` pair shared by both trader genders (picked via
 * `dialogueByType`'s `"*-treasurehunter-*"` vs `"*"` glob keys on `entities/humanoid/
 * trader-{male,female}.json`), one generic `villager` file plus 18 per-named-villager files
 * (agnieszka/alba/arzhur/beata/folds/gerhardt/indira/kat/laura/lena/liga/norbert/piotr/sedna/tad/
 * tobias/waclaw/wall, keyed by `entities/humanoid/villager.json`'s `behaviorConfigs.conversable.
 * dialogueByType`, note: nested directly under `behaviorConfigs`, not inside a `behaviors` array
 * entry like the trader/skeleton cases), and 3 files (`skeletonarm`/`skeletonwithloot`/
 * `resonator`) belonging to inanimate "conversable" lore props for the Resonance Archive puzzle
 * that have no "health" server behavior and so never get a `/creatures/` page (see
 * `hasHealthBehavior`) -- `example.json` is an unused template/reference file no real entity
 * points to, and is correctly never reached by this extraction since it walks entity variants
 * outward to their dialogue file, not dialogue files inward to guess an owner.
 *
 * No mod under `Mods/` adds any `config/dialogue/` files or entity `conversable`/`dialogueByType`
 * behaviors of its own (confirmed by grep across all loaded domains) -- this is a 100% vanilla
 * feature in the currently-pinned mod set.
 *
 * One `NpcDialogue` per concrete entity variant (via the same `expandVariants`/`resolveByType`
 * mechanism `models/loot.ts` uses for drops/spawn conditions), restricted to variants with the
 * "health" behavior so every entry actually has a `/creatures/` page to attach to.
 */
export function extractDialogue(index: AssetIndex, lang: LangResolver): NpcDialogue[] {
  const out: NpcDialogue[] = [];
  // Parsing is cached per dialogue file (keyed by "domain:relPath") since many entity variants
  // (both trader genders, most villager jobs) resolve to the exact same file.
  const fileCache = new Map<string, ParsedDialogueFile | undefined>();

  function loadDialogueFile(domain: string, relPath: string): ParsedDialogueFile | undefined {
    const key = `${domain}:${relPath}`;
    if (fileCache.has(key)) return fileCache.get(key);
    const asset = index.get(`${domain}:${relPath}.json`);
    const parsed = asset ? parseDialogueFile(asset.json as RawDialogueFile, asset.domain, lang) : undefined;
    fileCache.set(key, parsed);
    return parsed;
  }

  const entityVariants = expandVariants(index, ["entities/"]);
  for (const variant of entityVariants) {
    const json = variant.json as any;
    if (!hasHealthBehavior(json)) continue;

    const conversable = findConversableConfig(json);
    if (!conversable) continue;
    const dialoguePath = conversable.dialogue ?? resolveByType(conversable.dialogueByType, variant.code);
    if (!dialoguePath) continue;

    const { domain: dlgDomain, bareCode: dlgRelPath } = splitDomainCode(dialoguePath, variant.domain);
    const parsed = loadDialogueFile(dlgDomain, dlgRelPath);
    if (!parsed || (!parsed.lines.length && !parsed.rewards.length)) continue;

    out.push({
      id: `${variant.domain}:${variant.code}`,
      domain: variant.domain,
      code: variant.code,
      sourceMod: variant.sourceModid,
      sourceDisplayName: lang.displayName("entity", variant.domain, variant.code).name,
      dialogueFile: dlgRelPath.split("/").pop() ?? dlgRelPath,
      lines: parsed.lines,
      rewards: parsed.rewards,
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}
