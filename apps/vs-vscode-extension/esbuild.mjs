// Bundles the two halves of the extension into dist/:
//   extension.js  the Node extension host (CommonJS, `vscode` provided by the host at runtime)
//   webview.js    the browser-side preview (+ webview.css from the CSS it imports), with three.js and
//                 the vs-schematic lib inlined -- a webview can't use the wiki's importmap.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build, context } from "esbuild";

const require = createRequire(import.meta.url);
const watch = process.argv.includes("--watch");

const common = { bundle: true, sourcemap: true, logLevel: "info", minify: !watch };

const configs = [
  {
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
  },
  {
    ...common,
    entryPoints: { webview: "src/webview/main.ts" },
    outdir: "dist",
    platform: "browser",
    format: "iife",
    target: "es2022",
    // The lib imports three's addons through the wiki's importmap alias (`three/addons/...`).
    alias: {
      "three/addons/OrbitControls.js": join(dirname(require.resolve("three")), "..", "examples/jsm/controls/OrbitControls.js"),
    },
  },
];

if (watch) {
  for (const config of configs) await (await context(config)).watch();
} else {
  await Promise.all(configs.map((config) => build(config)));
}
