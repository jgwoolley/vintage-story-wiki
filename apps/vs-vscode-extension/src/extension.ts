import { randomBytes } from "node:crypto";
import { basename, dirname } from "node:path";
import { gunzipSync } from "node:zlib";
import * as vscode from "vscode";
import type { HostMessage, WebviewMessage } from "./protocol.js";
import { buildWebviewHtml } from "./webviewHtml.js";

const VIEW_TYPE = "vsSchematic.preview";

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
        await post({ type: "schematic", name: fileName, text, body: text.includes("stepParentName") ? await findBodyShape(document.uri) : undefined });
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
      }
    });
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("vsSchematic")) sendSettings();
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
  );
}

export function deactivate(): void {}
