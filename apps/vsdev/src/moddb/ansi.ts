// Terminal colors via picocolors (the same dependency skills-pages uses). It honors NO_COLOR / FORCE_COLOR and turns itself off when
// stdout isn't a terminal; stderr gets its own instance since it can be a terminal while stdout is piped (or the reverse).
import pc from "picocolors";

const errColors = pc.createColors(
  !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || (!!process.stderr.isTTY && process.env.TERM !== "dumb")),
);

export const { green, red, yellow, cyan, dim, bold } = pc;
export const redError = errColors.red;

/** "modid: message", the modid in cyan and the message in `color`. */
export const modLine = (modid: string, message: string, color: (s: string) => string) => `${cyan(modid)}: ${color(message)}`;
