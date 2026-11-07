import { randomBytes } from "node:crypto";
import { basename, dirname } from "node:path";
import { gunzipSync } from "node:zlib";
import * as vscode from "vscode";
import type { HostMessage, ModelTextures, WebviewMessage } from "./protocol.js";
import { gameAssetsCandidates, resolveTextures, TEXTURE_PROBE } from "vs-schematic/textureFiles.js";
import { buildWebviewHtml } from "./webviewHtml.js";

const VIEW_TYPE = "vsSchematic.preview";
const SELECT_GAME_FOLDER = "vsSchematic.selectGameFolder";

async function readOptional(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
}

/** The `assets` folder (as a URI path) of a folder the user picked, when it has the client's textures; undefined otherwise. */
async function gameAssetsDir(folder: string): Promise<string | undefined> {
  if (!folder.trim()) return undefined;
  const base = vscode.Uri.file(folder);
  for (const candidate of gameAssetsCandidates(base.path)) {
    if (await readOptional(base.with({ path: `${candidate}/${TEXTURE_PROBE}` }))) return candidate;
  }
  return undefined;
}

/** A model file's textures, from its own assets tree or the configured game folder. Undefined for anything that isn't a model. */
async function modelTextures(uri: vscode.Uri, text: string): Promise<ModelTextures | undefined> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined; // not plain JSON (a ChiselTools XML shape); the webview reports real parse errors
  }
  if (!Array.isArray((json as { elements?: unknown } | null)?.elements)) return undefined;
  const gameFolder = vscode.workspace.getConfiguration("vsSchematic").get<string>("gameFolder", "");
  const assets = await gameAssetsDir(gameFolder);
  // The game folder is a local folder; the model's own tree is read through the document's scheme (local or remote).
  const read = (path: string) => readOptional(assets && path.startsWith(`${assets}/`) ? vscode.Uri.from({ scheme: "file", path }) : uri.with({ path }));
  const resolved = await resolveTextures(json, uri.path, assets, read);
  return { ...resolved, gameFolder: gameFolder || undefined };
}

/**
 * Asks for the game's install folder, checks it has the client's textures, and saves it to the user's vsSchematic.gameFolder
 * setting (every open preview then reloads with textures).
 */
async function selectGameFolder(): Promise<void> {
  const current = vscode.workspace.getConfiguration("vsSchematic").get<string>("gameFolder", "");
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: current ? vscode.Uri.file(current) : undefined,
    openLabel: "Use this game folder",
    title: "Vintage Story game folder (the client install, which has assets/survival/textures)",
  });
  const folder = picked?.[0]?.fsPath;
  if (!folder) return;
  if (!(await gameAssetsDir(folder))) {
    const choice = await vscode.window.showWarningMessage(
      `${folder} has no textures (no assets/${TEXTURE_PROBE}). The dedicated server download ships almost none: pick the game client's install folder.`,
      "Choose another folder",
    );
    if (choice) await selectGameFolder();
    return;
  }
  await vscode.workspace.getConfiguration("vsSchematic").update("gameFolder", folder, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`Vintage Story textures will be loaded from ${folder}.`);
}

/** A schematic file; nothing to load up front, the webview asks for the text once it's ready. */
class SchematicDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}
  dispose(): void {}
}

/** Reads a schematic, transparently gunzipping the wiki's `.json.gz` copies. */
async function readSchematicText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const raw = uri.path.endsWith(".gz") ? gunzipSync(bytes) : bytes;
  return new TextDecoder().decode(raw);
}

/** Where the game keeps the player body model that armor and clothing models hang their pieces on, relative to an assets domain folder. */
const BODY_SHAPE = ["shapes", "entity", "humanoid", "seraph-faceless.json"];

/**
 * A worn item's model (`stepParentName` elements) only makes sense on the player body, which is a separate game file. Looks for it where
 * the game lays it out: `assets/<domain>/shapes/...`, in the model's own domain or in the vanilla `game` one beside it. Undefined when
 * the file isn't inside such a tree; the preview then shows the pieces unplaced.
 */
async function findBodyShape(uri: vscode.Uri): Promise<string | undefined> {
  const parts = uri.path.split("/");
  const at = parts.lastIndexOf("shapes");
  if (at < 1) return undefined;
  const domainDir = uri.with({ path: parts.slice(0, at).join("/") });
  const assetsDir = uri.with({ path: parts.slice(0, at - 1).join("/") });
  for (const dir of [domainDir, vscode.Uri.joinPath(assetsDir, "game"), vscode.Uri.joinPath(assetsDir, "survival")]) {
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, ...BODY_SHAPE)));
    } catch {
      // not in this domain; try the next
    }
  }
  return undefined;
}

class SchematicEditorProvider implements vscode.CustomReadonlyEditorProvider<SchematicDocument> {
  constructor(private readonly extensionUri: vscode.Uri) {}

  openCustomDocument(uri: vscode.Uri): SchematicDocument {
    return new SchematicDocument(uri);
  }

  async resolveCustomEditor(document: SchematicDocument, panel: vscode.WebviewPanel): Promise<void> {
    const { webview } = panel;
    const distUri = vscode.Uri.joinPath(this.extensionUri, "dist");
    webview.options = { enableScripts: true, localResourceRoots: [distUri] };
    const fileName = basename(document.uri.path);
    webview.html = buildWebviewHtml({
      cspSource: webview.cspSource,
      nonce: randomBytes(16).toString("base64"),
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(distUri, "webview.js")).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(distUri, "webview.css")).toString(),
      title: fileName,
    });

    const post = (message: HostMessage) => webview.postMessage(message);
    const send = async () => {
      try {
        const text = await readSchematicText(document.uri);
        await post({
          type: "schematic",
          name: fileName,
          text,
          body: text.includes("stepParentName") ? await findBodyShape(document.uri) : undefined,
          textures: await modelTextures(document.uri, text),
        });
      } catch (err) {
        await post({ type: "error", message: `Could not read ${fileName}: ${err instanceof Error ? err.message : String(err)}` });
      }
    };

    const sendSettings = () => {
      const config = vscode.workspace.getConfiguration("vsSchematic");
      void post({ type: "settings", centerMarker: config.get<boolean>("showCenterMarker", false), grid: config.get<boolean>("showGrid", false) });
    };

    // The webview's script loads asynchronously, so it asks for the file instead of being pushed it.
    panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      if (message.type === "ready") {
        sendSettings();
        void send();
      } else if (message.type === "selectGameFolder") {
        void vscode.commands.executeCommand(SELECT_GAME_FOLDER);
      }
    });
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("vsSchematic.gameFolder")) void send(); // reload the model with the new folder's textures
      else if (e.affectsConfiguration("vsSchematic")) sendSettings();
    });
    panel.onDidDispose(() => configWatcher.dispose());

    // Reload when the file changes on disk (e.g. it's regenerated or re-saved from the game).
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(dirname(document.uri.fsPath)), basename(document.uri.fsPath)),
    );
    watcher.onDidChange(() => void send());
    panel.onDidDispose(() => watcher.dispose());
  }
}

/** The resource a command was invoked on: an explorer/title-bar argument, else the active tab's file. */
function targetUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) return input.uri;
  return vscode.window.activeTextEditor?.document.uri;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new SchematicEditorProvider(context.extensionUri), {
      webviewOptions: { retainContextWhenHidden: true }, // keep the camera and WebGL scene when the tab is hidden
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand("vsSchematic.openPreview", async (arg?: unknown) => {
      const uri = targetUri(arg);
      if (!uri) {
        void vscode.window.showInformationMessage("Open a Vintage Story schematic (.json or .json.gz) first.");
        return;
      }
      await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
    }),
    vscode.commands.registerCommand(SELECT_GAME_FOLDER, selectGameFolder),
  );
}

export function deactivate(): void {}
