import fs from 'node:fs';
import path from 'node:path';
import type { CLIArgs, ApilensConfig } from '../types.js';
import { resolvePackages } from '../resolver.js';
import { Sandbox } from '../sandbox.js';

/**
 * Read code from stdin (for heredoc / pipe usage).
 */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

export async function execCommand(args: CLIArgs, config: ApilensConfig): Promise<void> {
  const filePath = args.positional[0];

  let code: string;

  if (!filePath || filePath === '-') {
    // Read from stdin (supports heredoc and pipe)
    if (process.stdin.isTTY) {
      process.stderr.write('Usage: apilens exec <file.ts>\n');
      process.stderr.write('       apilens exec - <<\'SCRIPT\' ... SCRIPT\n');
      process.exitCode = 1;
      return;
    }
    code = await readStdin();
  } else {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      process.stderr.write(`File not found: ${resolved}\n`);
      process.exitCode = 1;
      return;
    }
    code = fs.readFileSync(resolved, 'utf-8');
  }

  if (!code.trim()) {
    process.stderr.write('No code provided.\n');
    process.exitCode = 1;
    return;
  }

  try {
    const resolvedPaths = await resolvePackages(config, {
      verbose: args.verbose,
      quiet: args.quiet,
    });

    if (resolvedPaths.resolved.length === 0) {
      process.stderr.write('No packages could be resolved.\n');
      process.exitCode = 1;
      return;
    }

    const sandbox = new Sandbox({
      allowedModules: config.libraries.map((l) => l.name),
      modulesBasePath: resolvedPaths.basePaths[0]!,
    });

    const timeoutMs = args.timeout ?? 30000;
    const result = await sandbox.execute(code, timeoutMs);

    if (result.output) {
      process.stdout.write(result.output + '\n');
    }

    if (result.error) {
      process.stderr.write(result.error + '\n');
    }

    // Force exit — libraries (e.g. HTTP clients) may hold open connections
    // that keep the event loop alive indefinitely.
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
