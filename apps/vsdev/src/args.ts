// Option parsing shared by the vsdev commands (render keeps its own, older parser): node:util's parseArgs, with its errors turned into
// UsageError so the CLI prints the command's usage instead of a stack trace.
import { parseArgs, type ParseArgsConfig } from "node:util";
import { UsageError } from "./errors.js";

type Options = NonNullable<ParseArgsConfig["options"]>;

export function parseCommand<O extends Options>(argv: string[], options: O) {
  try {
    return parseArgs({ args: argv, options: { ...options, help: { type: "boolean", short: "h" } }, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError((err as Error).message.replace(/^TypeError \[[A-Z_]+\]: /, ""));
  }
}

/**
 * A table with left-aligned columns, two spaces apart. `style(row, col, cell)` may color a cell; padding is computed on the plain text, so
 * colors don't break the alignment (row 0 is the header).
 */
export function table(rows: string[][], style?: (row: number, col: number, cell: string) => string): string {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
  return rows.map((r, i) => r.map((cell, c) => {
    const text = cell ?? "";
    const shown = style ? style(i, c, text) : text;
    return c === r.length - 1 ? shown : shown + " ".repeat(widths[c] - text.length);
  }).join("  ").trimEnd()).join("\n");
}
