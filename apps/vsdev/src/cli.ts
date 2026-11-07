// vsdev: Vintage Story dev tools on the command line. Bundled by esbuild.mjs to dist/cli.js (the package's `bin`) for a global install;
// in the repo it also runs from source with `npm run vsdev -w @nf3t/vsdev -- <command>`.
import { main } from "./main.js";

// `vsdev paths | head`: the reader went away; stop quietly instead of crashing on EPIPE.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

process.exitCode = await main(process.argv.slice(2));
