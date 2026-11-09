// The confirmation before a command changes files (clack's yes/no prompt, the same as skills-pages). Without a terminal there is nobody
// to ask, so it refuses unless -y was given (scripts and agents pass -y), rather than silently going ahead or hanging.
import { confirm as ask, isCancel } from "@clack/prompts";
import { CliError } from "./errors.js";

export async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  const message = question.trim();
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new CliError(`${message} needs confirmation: pass -y (no terminal to ask on)`, 2);
  const answer = await ask({ message, initialValue: false });
  return !isCancel(answer) && answer;
}
