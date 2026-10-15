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
        await post({ type: "schematic", name: fileName, text: await readSchematicText(document.uri) });
      } catch (err) {
        await post({ type: "error", message: `Could not read ${fileName}: ${err instanceof Error ? err.message : String(err)}` });
      }
    };

    // The webview's script loads asynchronously, so it asks for the file instead of being pushed it.
    panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      if (message.type === "ready") void send();
    });

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
