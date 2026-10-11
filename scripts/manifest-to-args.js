#!/usr/bin/env node
// Reads vs-manifest.json and prints the equivalent download.sh CLI flags,
// so CI and local dev share one pinned source of truth for versions.
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../vs-manifest.json", import.meta.url), "utf8"));

const args = [
  "--server-branch", manifest.serverBranch,
  "--server-version", manifest.serverVersion,
];

for (const mod of manifest.mods ?? []) {
  const spec = mod.version ? `${mod.modid}:${mod.version}` : mod.modid;
  args.push("--mod", spec);
}

// No quoting: `$(...)` output is only word-split by the shell, never quote-parsed, so adding
// quote characters here would pass them through literally to download.sh. Values here (branch,
// version, modid:version) never contain whitespace, so plain space-separation is safe.
process.stdout.write(args.join(" "));
