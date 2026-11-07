// Minimal terminal colors (ModDbCli's Ansi.cs): off when the output isn't a terminal or NO_COLOR is set; FORCE_COLOR turns them on.
const detect = (tty: boolean | undefined) => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return !!tty && process.env.TERM !== "dumb";
};
const out = detect(process.stdout.isTTY);
const err = detect(process.stderr.isTTY);
const wrap = (code: string, on: boolean) => (text: string) => (on && text ? `\x1b[${code}m${text}\x1b[0m` : text);

export const green = wrap("32", out);
export const red = wrap("31", out);
export const yellow = wrap("33", out);
export const cyan = wrap("36", out);
export const dim = wrap("2", out);
export const bold = wrap("1", out);
export const redError = wrap("31", err);

/** "modid: message", the modid in cyan and the message in `color`. */
export const modLine = (modid: string, message: string, color: (s: string) => string) => `${cyan(modid)}: ${color(message)}`;
