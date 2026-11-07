// Unpacking a mod zip into a folder (its assets/ tree, modinfo.json...), so its shapes can be rendered or its JSON read directly.
// Refuses an entry whose path would land outside the target folder ("zip slip": ../ or an absolute path in the entry name).
import AdmZip from "adm-zip";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Extracts `zip` into `outDir`; returns the number of files written. Throws before writing anything if an entry escapes `outDir`. */
export function extractZip(zip: string | Buffer, outDir: string): number {
  const root = path.resolve(outDir);
  const entries = new AdmZip(zip).getEntries();
  const targets = entries.map((e) => {
    const target = path.resolve(root, e.entryName.replace(/\\/g, "/"));
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`refusing to extract ${e.entryName}: it points outside ${outDir}`);
    return target;
  });
  let files = 0;
  entries.forEach((e, i) => {
    if (e.isDirectory) {
      mkdirSync(targets[i], { recursive: true });
      return;
    }
    mkdirSync(path.dirname(targets[i]), { recursive: true });
    writeFileSync(targets[i], e.getData());
    files++;
  });
  return files;
}

/** The folder a zip extracts into under `outDir`: its file name without .zip. */
export const extractFolderFor = (zipFile: string, outDir: string) => path.join(outDir, path.basename(zipFile).replace(/\.zip$/i, ""));
