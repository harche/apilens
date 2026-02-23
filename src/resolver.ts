import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ApilensConfig, ResolvedPaths } from './types.js';

/**
 * Check if a package is installed at the given base path.
 */
function isPackageInstalled(basePath: string, packageName: string): boolean {
  const pkgPath = path.join(basePath, 'node_modules', packageName);
  return fs.existsSync(pkgPath);
}

/**
 * Walk upward from startDir looking for node_modules containing the package.
 */
function findPackageUpward(startDir: string, packageName: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    if (isPackageInstalled(dir, packageName)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Install packages into a target directory (e.g. the project CWD).
 * Skips packages already present in node_modules.
 */
export async function installPackagesLocally(
  config: ApilensConfig,
  targetDir: string,
  options: { verbose?: boolean; quiet?: boolean } = {},
): Promise<{ installed: string[]; alreadyPresent: string[] }> {
  const verbose = options.verbose ?? false;
  const quiet = options.quiet ?? false;
  const needsInstall: string[] = [];
  const alreadyPresent: string[] = [];

  for (const lib of config.libraries) {
    if (isPackageInstalled(targetDir, lib.name)) {
      alreadyPresent.push(lib.name);
    } else {
      needsInstall.push(lib.name);
    }
  }

  if (needsInstall.length > 0) {
    if (!quiet) {
      process.stderr.write(
        `Installing ${needsInstall.length} package(s) into project: ${needsInstall.join(', ')}...\n`,
      );
    }

    // Ensure the target directory has a package.json
    const pkgJsonPath = path.join(targetDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      await fs.promises.writeFile(
        pkgJsonPath,
        JSON.stringify({ name: 'apilens-project', private: true }, null, 2),
        'utf-8',
      );
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'npm',
        ['install', '--no-audit', '--no-fund', '--no-progress', ...needsInstall],
        {
          cwd: targetDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        },
      );

      let stderr = '';
      child.stdout?.on('data', (data: Buffer) => {
        if (verbose) {
          process.stderr.write(`[npm] ${data.toString().trim()}\n`);
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (error) => reject(error));
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm install failed (exit ${code}): ${stderr.trim()}`));
        }
      });
    });
  } else if (!quiet) {
    process.stderr.write('All packages already installed in project.\n');
  }

  return { installed: needsInstall, alreadyPresent };
}

/**
 * Resolve all configured packages from the project's node_modules.
 * Requires `install --skills` to have been run first.
 */
export async function resolvePackages(
  config: ApilensConfig,
  options: { verbose?: boolean; quiet?: boolean } = {},
): Promise<ResolvedPaths> {
  const verbose = options.verbose ?? false;
  const basePaths = new Set<string>();
  const resolved: string[] = [];
  const failed: string[] = [];

  for (const lib of config.libraries) {
    const projectPath = findPackageUpward(process.cwd(), lib.name);
    if (projectPath) {
      basePaths.add(projectPath);
      resolved.push(lib.name);
      if (verbose) {
        process.stderr.write(`Found ${lib.name} in project: ${projectPath}\n`);
      }
    } else {
      failed.push(lib.name);
    }
  }

  return { basePaths: [...basePaths], resolved, failed };
}
