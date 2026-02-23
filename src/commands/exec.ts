import fs from 'node:fs';
import path from 'node:path';
import type { CLIArgs } from '../types.js';
import {
  Sandbox,
  findNearestNodeModulesBasePath,
  discoverPackagesInNodeModules,
} from '../sandbox.js';

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

/**
 * Determine sandbox configuration without a config file.
 *
 * Priority:
 * 1. APILENS_ALLOWED_LIST env var (comma-separated package names)
 * 2. All packages found in the nearest node_modules/
 */
function resolveExecSandboxConfig(): { allowedModules: string[]; modulesBasePath: string } {
  const basePath = findNearestNodeModulesBasePath(process.cwd());

  const envList = process.env['APILENS_ALLOWED_LIST'];
  if (envList) {
    const allowedModules = envList
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (allowedModules.length === 0) {
      throw new Error('APILENS_ALLOWED_LIST is set but contains no valid package names.');
    }
    return { allowedModules, modulesBasePath: basePath };
  }

  const allowedModules = discoverPackagesInNodeModules(basePath);
  if (allowedModules.length === 0) {
    throw new Error(
      'No packages found in node_modules/. Install packages first or set APILENS_ALLOWED_LIST.',
    );
  }

  return { allowedModules, modulesBasePath: basePath };
}

export async function execCommand(args: CLIArgs): Promise<void> {
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
    const sandboxConfig = resolveExecSandboxConfig();

    if (args.verbose) {
      process.stderr.write(`Sandbox base path: ${sandboxConfig.modulesBasePath}\n`);
      process.stderr.write(
        `Allowed modules (${sandboxConfig.allowedModules.length}): ${sandboxConfig.allowedModules.join(', ')}\n`,
      );
    }

    const sandbox = new Sandbox(sandboxConfig);

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
