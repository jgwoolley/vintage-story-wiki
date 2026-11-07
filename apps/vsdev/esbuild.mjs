// Builds vsdev into dist/:
// - dist/page.js: the renderer's browser half (src/render/page/main.ts), one IIFE with three.js and vs-schematic inlined, because
//   the page is loaded with setContent and has no importmap or server (same settings as the VS Code extension's webview bundle);
// - dist/cli.js: the `vsdev` command (the package's bin), Node ESM with vs-schematic inlined (it is TypeScript-only, so a global
//   install can't import it); the published packages it needs (playwright-core, tar, adm-zip, json5) stay real dependencies;
// - dist/blockColors.json: the wiki's block colors (BlockColorMod output), the renderer's default for schematics and .pf shapes;
// - dist/web/: the `vsdev moddb serve` review page (src/moddb/web), dist/page.schema.json (moddb/<modid>/page.json's schema) and
//   dist/vs-manifest.schema.json (the repo root's, describing vs-manifest.json).
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const here = dirname(new URL(import.meta.url).pathname);

await build({
  entryPoints: { page: "src/render/page/main.ts" },
  outdir: "dist",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  logLevel: "warning",
  absWorkingDir: here,
  // The lib imports three's addons through the wiki's importmap alias (`three/addons/...`).
  alias: {
    "three/addons/OrbitControls.js": join(dirname(require.resolve("three")), "..", "examples/jsm/controls/OrbitControls.js"),
  },
});

await build({
  entryPoints: { cli: "src/cli.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "warning",
  absWorkingDir: here,
  // npm packages stay imports (installed as dependencies)...
  packages: "external",
  // ...except our own TypeScript-only workspace lib, which has to be inlined.
  plugins: [{
    name: "inline-vs-schematic",
    setup(b) {
      b.onResolve({ filter: /^vs-schematic\// }, (args) => ({ path: join(here, "../../libs/vs-schematic/src", args.path.slice("vs-schematic/".length).replace(/\.js$/, ".ts")) }));
    },
  }],
  banner: { js: "#!/usr/bin/env node" },
});

mkdirSync(join(here, "dist"), { recursive: true });
copyFileSync(join(here, "../vs-wiki/site/assets/Nf3tBlockColors.json"), join(here, "dist/blockColors.json"));
cpSync(join(here, "src/moddb/web"), join(here, "dist/web"), { recursive: true });
copyFileSync(join(here, "src/moddb/page.schema.json"), join(here, "dist/page.schema.json"));
copyFileSync(join(here, "../../vs-manifest.schema.json"), join(here, "dist/vs-manifest.schema.json"));
