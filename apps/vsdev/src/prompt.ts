// The [y/N] confirmation before a command changes files. Without a terminal there is nobody to ask, so it refuses unless -y was
// given (scripts and agents pass -y), rather than silently going ahead or hanging.
import { createInterface } from "node:readline/promises";
import { CliError } from "./errors.js";

export async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new CliError(`${question} needs confirmation: pass -y (no terminal to ask on)`, 2);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}
