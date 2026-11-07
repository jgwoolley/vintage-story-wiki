// Errors the CLI reports as one line instead of a stack trace. UsageError is a bad command line (exit 2, with the command's usage);
// CliError is anything else that stops a command (exit 1 unless it says otherwise).
export class UsageError extends Error {}

export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
  }
}
