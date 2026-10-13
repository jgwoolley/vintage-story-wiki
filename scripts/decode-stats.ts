// Opt-in corpus check (needs `npm run download` first, so it isn't part of `npm test`): decodes every
// block entity in every local worldgen schematic and reports failures. The count should stay at 0.
import { existsSync, readFileSync } from "node:fs";
import { listSchematicFiles } from "../src/ingest/schematicHeader.js";
import { decodeBlockEntity } from "../site/assets/schematicDecode.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const roots: { domain: string; dir: string }[] = [];
if (existsSync("vs_server/assets")) {
  for (const d of readdirSync("vs_server/assets")) roots.push({ domain: d, dir: join("vs_server/assets", d) });
}
if (existsSync(".scratch/mods")) {
  for (const mod of readdirSync(".scratch/mods")) {
    const assets = join(".scratch/mods", mod, "assets");
    if (existsSync(assets)) for (const d of readdirSync(assets)) roots.push({ domain: d, dir: join(assets, d) });
  }
}

let files = 0, entities = 0, failures = 0;
const errors = new Map<string, number>();
const start = Date.now();
for (const root of roots) {
  for (const f of listSchematicFiles(root.domain, root.dir)) {
    let json: { BlockEntities?: Record<string, string> };
    try { json = JSON.parse(readFileSync(f.fullPath, "utf8")); } catch { continue; }
    files++;
    for (const blob of Object.values(json.BlockEntities ?? {})) {
      entities++;
      try {
        decodeBlockEntity(blob);
      } catch (e) {
        failures++;
        const msg = (e as Error).message.replace(/\d+/g, "N");
        errors.set(msg, (errors.get(msg) ?? 0) + 1);
      }
    }
  }
}
console.log(`${files} schematics, ${entities} block entities, ${failures} failed to decode (${Date.now() - start}ms)`);
for (const [msg, n] of errors) console.log(`  ${n}x ${msg}`);
process.exitCode = failures ? 1 : 0;
