// Launches a real VS Code with this extension loaded from source, opens a schematic, a ChiselTools shape and a few game model files
// (a weapon, a creature, armor placed on the player body), and screenshots each preview. It is the check that the extension actually
// works at runtime (type-checking and bundling can't tell). Needs the game data under the repo's vs_server/ (npm run download).
//
//   npm run screenshots                       writes .tmp/screenshots/*.png
//   VSCODE_TEST_CACHE=/path npm run screenshots   reuse an already downloaded VS Code (default: .vscode-test/ here)
//
// Headless: Electron runs with --ozone-platform=headless, so no X server is needed. Modelled on ../nifi-flowfile-extension's script.
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { _electron as electron } from "playwright-core";

const VSCODE_VERSION = "1.143.1"; // pinned so runs are reproducible; bump deliberately
const WINDOW = { width: 1400, height: 900 };
const TIMEOUT = 45_000;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const tmpDir = path.join(root, ".tmp");
const samplesDir = path.join(tmpDir, "samples");
const outDir = path.join(tmpDir, "screenshots");

/** Files copied into the sample workspace, laid out like the game's assets so the body model can be found next to the armor. */
const SAMPLES = [
  ["apps/vs-wiki/site/tools/schematic/samples/small_shrine.json", "small_shrine.json"],
  ["libs/vs-schematic/test/fixtures/wayshrine-pillar-bottom.pf", "wayshrine-pillar-bottom.pf"],
  // ChiselTools saves shapes with no extension, in the chiselportfolio folder; the preview must still open for such a file.
  ["libs/vs-schematic/test/fixtures/wayshrine-pillar-bottom.pf", "chiselportfolio/wayshrine-noext"],
  ["vs_server/assets/survival/shapes/item/tool/blade/admin.json", "assets/survival/shapes/item/tool/blade/admin.json"],
  ["vs_server/assets/survival/shapes/entity/animal/mammal/wolf/eurasian-adult.json", "assets/survival/shapes/entity/animal/mammal/wolf/eurasian-adult.json"],
  ["vs_server/assets/survival/shapes/entity/humanoid/seraph/armor/plate/body.json", "assets/survival/shapes/entity/humanoid/seraph/armor/plate/body.json"],
  ["vs_server/assets/game/shapes/entity/humanoid/seraph-faceless.json", "assets/game/shapes/entity/humanoid/seraph-faceless.json"],
];

// [file to open, text the summary must show, screenshot name]
const CASES = [
  ["small_shrine.json", /blocks/, "schematic"],
  ["wayshrine-pillar-bottom.pf", /chiseled block/, "chisel"],
  ["admin.json", /model, \d+ boxes/, "model-sword"],
  ["eurasian-adult.json", /model, \d+ boxes/, "model-wolf"],
  ["body.json", /placed on the player body/, "model-armor"],
  ["wayshrine-noext", /chiseled block/, "chisel-noext"],
];

class ScreenshotError extends Error {}

async function main() {
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const [from, to] of SAMPLES) {
    await mkdir(path.dirname(path.join(samplesDir, to)), { recursive: true });
    await copyFile(path.join(repo, from), path.join(samplesDir, to));
  }
  const executablePath = await downloadAndUnzipVSCode({ version: VSCODE_VERSION, cachePath: process.env.VSCODE_TEST_CACHE ?? path.join(root, ".vscode-test") });

  const userDataDir = path.join(tmpDir, "user-data");
  const extensionsDir = path.join(tmpDir, "extensions");
  await mkdir(path.join(userDataDir, "User"), { recursive: true });
  await mkdir(extensionsDir, { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    path.join(userDataDir, "User", "settings.json"),
    JSON.stringify({
      "workbench.colorTheme": "Default Dark Modern",
      "workbench.startupEditor": "none",
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "security.workspace.trust.enabled": false,
      "git.enabled": false,
      "chat.disableAIFeatures": true,
      "workbench.secondarySideBar.defaultVisibility": "hidden",
      "vsSchematic.showCenterMarker": false,
    }),
  );

  const app = await electron.launch({
    executablePath,
    args: [
      samplesDir,
      // Every case file opens as a tab at launch (quick open's file search is unreliable in a fresh headless profile).
      ...CASES.map(([file]) => path.join(samplesDir, SAMPLES.find(([, to]) => to.endsWith(file))[1])),
      `--extensionDevelopmentPath=${root}`,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-updates",
      "--no-sandbox",
      // Software WebGL (SwiftShader), so the Three.js canvas draws without a GPU; --disable-gpu would turn WebGL off entirely.
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--ozone-platform=headless",
    ],
  });

  try {
    const page = await app.firstWindow();
    await page.setViewportSize(WINDOW).catch(() => undefined);
    const fail = async (what, cause) => {
      const file = path.join(tmpDir, `failure-${Date.now()}.png`);
      await page.screenshot({ path: file }).catch(() => undefined);
      throw new ScreenshotError(`${what}${cause instanceof Error ? `: ${cause.message.split("\n")[0]}` : ""}\n  debug screenshot: ${file}`);
    };
    const waitFor = (what, locator) => locator.first().waitFor({ state: "visible", timeout: TIMEOUT }).catch((e) => fail(`not visible: ${what}`, e));
    const webview = () => page.frameLocator("iframe.webview:visible").frameLocator("iframe#active-frame");

    await waitFor("workbench", page.locator(".monaco-workbench"));
    if (await page.locator(".part.sidebar").isVisible()) await page.keyboard.press("Control+B");

    const results = [];
    for (const [file, summary, name] of CASES) {
      await page.locator(".tabs-container .tab", { hasText: file }).first().click({ timeout: TIMEOUT }).catch((e) => fail(`tab ${file}`, e));
      // The editor title-bar button the extension contributes (the same command as the palette entry).
      await page.locator('.editor-actions a.action-label[aria-label^="Preview Schematic, Model"]').first().click({ timeout: TIMEOUT }).catch((e) => fail("title-bar preview button", e));
      const view = webview();
      await waitFor(`${file} summary`, view.locator("#summary", { hasText: summary }));
      await waitFor(`${file} 3D canvas`, view.locator("#viewport canvas"));
      await page.waitForTimeout(800); // let the first WebGL frame render
      const text = await view.locator("#summary").innerText();
      const error = await view.locator("#error").isVisible();
      if (error) await fail(`${file} shows an error: ${await view.locator("#error").innerText()}`);
      await page.locator(".part.editor").screenshot({ path: path.join(outDir, `${name}.png`) });
      results.push(`${file}: ${text}`);
    }
    console.log(results.join("\n"));
    console.log(`screenshots in ${path.relative(repo, outDir)}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof ScreenshotError ? `\nscreenshots failed: ${error.message}` : error);
  process.exit(1);
});
