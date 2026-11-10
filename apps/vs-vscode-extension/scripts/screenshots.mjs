// Launches a real VS Code with this extension loaded from source, opens a schematic, a ChiselTools shape and a few game model files
// (a weapon, a creature, armor placed on the player body), and screenshots each preview. It is the check that the extension actually
// works at runtime (type-checking and bundling can't tell). Needs the game data under the repo's vintagestory/ (npm run download; an old
// vs_server/ also works).
//
//   npm run screenshots                       writes .tmp/screenshots/*.png
//   VSCODE_TEST_CACHE=/path npm run screenshots   reuse an already downloaded VS Code (default: .vscode-test/ here)
//
// Headless: Electron runs with --ozone-platform=headless, so no X server is needed. Modelled on ../nifi-flowfile-extension's script.
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { deflateSync, crc32 } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { _electron as electron } from "playwright-core";

const VSCODE_VERSION = "1.143.1"; // pinned so runs are reproducible; bump deliberately
const WINDOW = { width: 1400, height: 900 };
const TIMEOUT = 45_000;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
/** The game install, where `npm run download` puts it (an old vs_server/ checkout too). */
const gameDir = existsSync(path.join(repo, "vintagestory")) ? "vintagestory" : "vs_server";
const tmpDir = path.join(root, ".tmp");
const samplesDir = path.join(tmpDir, "samples");
const outDir = path.join(tmpDir, "screenshots");

/** Files copied into the sample workspace, laid out like the game's assets so the body model can be found next to the armor. */
const SAMPLES = [
  ["apps/vs-wiki/site/schematics/viewer/samples/small_shrine.json", "small_shrine.json"],
  ["libs/vs-schematic/test/fixtures/wayshrine-pillar-bottom.pf", "wayshrine-pillar-bottom.pf"],
  // ChiselTools saves shapes with no extension, in the chiselportfolio folder; the preview must still open for such a file.
  ["libs/vs-schematic/test/fixtures/wayshrine-pillar-bottom.pf", "chiselportfolio/wayshrine-noext"],
  [`${gameDir}/assets/survival/shapes/item/tool/blade/admin.json`, "assets/survival/shapes/item/tool/blade/admin.json"],
  [`${gameDir}/assets/survival/shapes/entity/animal/mammal/wolf/eurasian-adult.json`, "assets/survival/shapes/entity/animal/mammal/wolf/eurasian-adult.json"],
  [`${gameDir}/assets/survival/shapes/entity/humanoid/seraph/armor/plate/body.json`, "assets/survival/shapes/entity/humanoid/seraph/armor/plate/body.json"],
  [`${gameDir}/assets/game/shapes/entity/humanoid/seraph-faceless.json`, "assets/game/shapes/entity/humanoid/seraph-faceless.json"],
];

/** A 16 x 16 red and blue checkerboard PNG (no dependencies), the texture of the sample model below. */
function checkerPng() {
  const raw = Buffer.alloc(16 * (1 + 16 * 3));
  for (let y = 0; y < 16; y++) {
    const row = y * (1 + 16 * 3);
    for (let x = 0; x < 16; x++) raw.set((x >> 2) % 2 === (y >> 2) % 2 ? [255, 0, 0] : [0, 0, 255], row + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(16, 0);
  header.writeUInt32BE(16, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A model with its own texture in its own assets tree, written into the sample workspace: the preview must draw it textured. */
const TEXTURED_MODEL = {
  file: "assets/shot/shapes/block/checker.json",
  texture: "assets/shot/textures/block/checker.png",
  shape: {
    textures: { checker: "shot:block/checker" },
    elements: [{ name: "cube", from: [2, 0, 2], to: [14, 12, 14], faces: Object.fromEntries(["north", "east", "south", "west", "up", "down"].map((f) => [f, { texture: "#checker", uv: [0, 0, 16, 16] }])) }],
  },
};

// [file to open, text the summary must show, screenshot name]
const CASES = [
  ["small_shrine.json", /blocks/, "schematic"],
  ["wayshrine-pillar-bottom.pf", /chiseled block/, "chisel"],
  ["admin.json", /model, \d+ boxes/, "model-sword"],
  ["eurasian-adult.json", /model, \d+ boxes/, "model-wolf", "walk"],
  ["body.json", /placed on the player body/, "model-armor"],
  ["checker.json", /model, 1 boxes/, "model-textured"],
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
  await mkdir(path.dirname(path.join(samplesDir, TEXTURED_MODEL.texture)), { recursive: true });
  await mkdir(path.dirname(path.join(samplesDir, TEXTURED_MODEL.file)), { recursive: true });
  await writeFile(path.join(samplesDir, TEXTURED_MODEL.texture), checkerPng());
  await writeFile(path.join(samplesDir, TEXTURED_MODEL.file), JSON.stringify(TEXTURED_MODEL.shape));
  const executablePath = await downloadAndUnzipVSCode({ version: VSCODE_VERSION, cachePath: process.env.VSCODE_TEST_CACHE ?? path.join(root, ".vscode-test") });

  const userDataDir = path.join(tmpDir, "user-data");
  const extensionsDir = path.join(tmpDir, "extensions");
  await mkdir(path.join(userDataDir, "User"), { recursive: true });
  await mkdir(extensionsDir, { recursive: true });
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
      ...CASES.map(([file]) => path.join(samplesDir, file === "checker.json" ? TEXTURED_MODEL.file : SAMPLES.find(([, to]) => to.endsWith(file))[1])),
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
    for (const [file, summary, name, animation] of CASES) {
      await page.locator(".tabs-container .tab", { hasText: file }).first().click({ timeout: TIMEOUT }).catch((e) => fail(`tab ${file}`, e));
      // The command palette entry (the same command as the Explorer's right-click item; the extension has no title-bar button).
      await page.keyboard.press("F1");
      await page.keyboard.type(">Vintage Story: Preview Schematic, Model");
      await waitFor("command palette entry", page.locator(".quick-input-list .monaco-list-row", { hasText: "Preview Schematic, Model or Chisel Shape" }));
      await page.keyboard.press("Enter");
      const view = webview();
      await waitFor(`${file} summary`, view.locator("#summary", { hasText: summary }));
      await waitFor(`${file} 3D canvas`, view.locator("#viewport canvas"));
      await page.waitForTimeout(800); // let the first WebGL frame render
      const text = await view.locator("#summary").innerText();
      const error = await view.locator("#error").isVisible();
      if (error) await fail(`${file} shows an error: ${await view.locator("#error").innerText()}`);
      await page.locator(".part.editor").screenshot({ path: path.join(outDir, `${name}.png`) });
      // Meta-filler, the Y slider and the block filter are a schematic's; a model or a chiseled block has no use for them.
      for (const id of ["#fillerBox", "#maxYBox", "#search", "#sideActions"]) {
        if ((await view.locator(id).isVisible()) !== (name === "schematic")) await fail(`${file}: ${id} should be ${name === "schematic" ? "shown" : "hidden"}`);
      }
      if (name === "model-textured") {
        // The 3D view alone (the legend swatch has the same two colors): its cube must show the texture's red and blue squares.
        const png = await view.locator("#viewport").screenshot({ path: path.join(outDir, `${name}-view.png`) });
        const { red, blue } = await page.evaluate(async (b64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${b64}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let red = 0, blue = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] > 150 && pixels[i + 1] < 80 && pixels[i + 2] < 80) red++;
            if (pixels[i + 2] > 150 && pixels[i] < 80 && pixels[i + 1] < 80) blue++;
          }
          return { red, blue };
        }, png.toString("base64"));
        if (red < 300 || blue < 300) await fail(`${file} isn't drawn with its texture (${red} red and ${blue} blue pixels in the 3D view)`);
        results.push(`${file}: drawn textured (${red} red, ${blue} blue pixels)`);
      }
      if (animation) {
        // Pick an animation from the toolbar: the model must start moving (two frames a moment apart differ).
        await view.locator("#anim").selectOption(animation);
        await page.waitForTimeout(500);
        const first = await page.locator(".part.editor").screenshot();
        await page.waitForTimeout(400);
        const second = await page.locator(".part.editor").screenshot();
        if (first.equals(second)) await fail(`${file} does not animate when "${animation}" is chosen`);
        await page.locator(".part.editor").screenshot({ path: path.join(outDir, `${name}-${animation}.png`) });
        results.push(`${file}: "${animation}" plays`);
        // The floor toggle draws a grid under the model: the picture must change.
        const before = await page.locator(".part.editor").screenshot();
        await view.locator("#floor").check({ force: true }); // forced: the switch is drawn by CSS and the model keeps animating, which can trip the stability wait
        await page.waitForTimeout(500);
        await page.locator(".part.editor").screenshot({ path: path.join(outDir, `${name}-floor.png`) });
        results.push(`${file}: floor toggle ${(await page.locator(".part.editor").screenshot()).equals(before) ? "DID NOT CHANGE" : "draws the floor"}`);
      }
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
