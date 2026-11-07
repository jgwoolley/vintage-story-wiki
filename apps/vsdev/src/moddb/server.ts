// The local, read-only review page (`vsdev moddb serve`): a node:http port of ModDbCli's WebServer.cs over ReportBuilder. The only file it
// writes is the checklist progress (<pages>/.progress.json).
// Security, for a server on the user's machine: it listens on 127.0.0.1 only; a request whose Host isn't 127.0.0.1/localhost on our
// port is refused (DNS rebinding: HttpListener's URL prefixes did this implicitly, node:http doesn't), as is a POST from another origin
// (another site could POST to localhost from the user's browser); image names are reduced to their base name.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { assetPath } from "../paths.js";
import { IMAGES_DIR } from "./files.js";
import type { ReportBuilder } from "./report.js";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const WEB: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
};

export interface ReviewServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startReviewServer(builder: ReportBuilder, modIds: string[], port: number, progressFile = path.join(builder.pagesDir, ".progress.json")): Promise<ReviewServer> {
  let actualPort = port;
  const allowedHost = (host: string | undefined) => host === `127.0.0.1:${actualPort}` || host === `localhost:${actualPort}`;

  const readProgress = (): Record<string, boolean> => {
    try {
      return existsSync(progressFile) ? JSON.parse(readFileSync(progressFile, "utf8")) : {};
    } catch {
      return {};
    }
  };

  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer) => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(body);
  };
  const json = (res: ServerResponse, value: unknown) => send(res, 200, "application/json", JSON.stringify(value));

  const body = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      data += c;
      if (data.length > 65536) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const p = url.pathname;
    if (!allowedHost(req.headers.host)) return send(res, 403, "text/plain", "forbidden host");
    const origin = req.headers.origin;
    if (req.method === "POST" && origin && !origin.startsWith("http://127.0.0.1:") && !origin.startsWith("http://localhost:")) return send(res, 403, "text/plain", "forbidden");

    if (req.method === "GET" && WEB[p]) {
      const [file, type] = WEB[p];
      return send(res, 200, type, readFileSync(assetPath(`web/${file}`, `src/moddb/web/${file}`)));
    }
    if (req.method === "GET" && p === "/api/mods") return json(res, modIds);
    if (req.method === "GET" && p === "/api/progress") return json(res, readProgress());
    if (req.method === "POST" && p === "/api/progress") {
      const data = JSON.parse(await body(req)) as { id?: unknown; done?: unknown };
      if (typeof data.id !== "string" || !data.id) return send(res, 400, "text/plain", "id required");
      const progress = readProgress();
      if (data.done === true) progress[data.id] = true;
      else delete progress[data.id];
      mkdirSync(path.dirname(progressFile), { recursive: true });
      writeFileSync(progressFile, `${JSON.stringify(progress, null, 2)}\n`);
      return json(res, {});
    }
    if (req.method === "POST" && p === "/api/refresh") {
      builder.refresh();
      return json(res, {});
    }
    if (req.method === "GET" && p.startsWith("/api/report/")) {
      const modid = decodeURIComponent(p.slice("/api/report/".length));
      if (!modIds.includes(modid)) return send(res, 404, "text/plain", "unknown mod");
      return json(res, await builder.build(modid));
    }
    if (req.method === "GET" && p.startsWith("/img/")) {
      const parts = p.slice("/img/".length).split("/");
      if (parts.length !== 2) return send(res, 404, "text/plain", "not found");
      const modid = decodeURIComponent(parts[0]);
      const name = path.basename(decodeURIComponent(parts[1]));
      if (!modIds.includes(modid) || !name || name === "." || name === "..") return send(res, 404, "text/plain", "not found");
      const file = path.join(builder.pagesDir, modid, IMAGES_DIR, name);
      if (!existsSync(file)) return send(res, 404, "text/plain", "not found");
      return send(res, 200, TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", readFileSync(file));
    }
    send(res, 404, "text/plain", "not found");
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err: Error) => {
      try {
        send(res, 500, "text/plain", err.message);
      } catch {
        // connection gone
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  actualPort = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${actualPort}/`,
    port: actualPort,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
