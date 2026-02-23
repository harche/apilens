/**
 * Write JSON output to stdout.
 */
export function writeOutput(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/**
 * Write an error response to stdout as JSON.
 */
export function writeError(message: string): void {
  writeOutput({ error: message });
}
