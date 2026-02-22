import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import type { ApilensConfig, ResolvedPaths } from './types.js';

const GLOBAL_CACHE_DIR = path.join(os.homedir(), '.apilens', 'packages');

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
 * Ensure the global cache directory exists with a package.json.
 */
async function ensureCacheDir(): Promise<void> {
  await fs.promises.mkdir(GLOBAL_CACHE_DIR, { recursive: true });
  const pkgJsonPath = path.join(GLOBAL_CACHE_DIR, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    await fs.promises.writeFile(
      pkgJsonPath,
      JSON.stringify({ name: 'apilens-packages-cache', private: true }, null, 2),
      'utf-8',
    );
  }
}

/**
 * Install packages into the global cache directory.
 */
async function npmInstallPackages(
  packages: string[],
  verbose: boolean,
): Promise<void> {
  if (packages.length === 0) return;

  await ensureCacheDir();

  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      'npm',
      ['install', '--no-audit', '--no-fund', '--no-progress', ...packages],
      {
        cwd: GLOBAL_CACHE_DIR,
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
 * Resolve all packages in the config, auto-installing missing ones.
 * Returns the base paths needed by LibraryIndexer.
 */
export async function resolvePackages(
  config: ApilensConfig,
  options: { verbose?: boolean; quiet?: boolean } = {},
): Promise<ResolvedPaths> {
  const verbose = options.verbose ?? false;
  const quiet = options.quiet ?? false;
  const basePaths = new Set<string>();
  const resolved: string[] = [];
  const needsInstall: string[] = [];

  for (const lib of config.libraries) {
    // 1. Check project node_modules (walk upward from CWD)
    const projectPath = findPackageUpward(process.cwd(), lib.name);
    if (projectPath) {
      basePaths.add(projectPath);
      resolved.push(lib.name);
      if (verbose) {
        process.stderr.write(`Found ${lib.name} in project: ${projectPath}\n`);
      }
      continue;
    }

    // 2. Check global cache
    if (isPackageInstalled(GLOBAL_CACHE_DIR, lib.name)) {
      basePaths.add(GLOBAL_CACHE_DIR);
      resolved.push(lib.name);
      if (verbose) {
        process.stderr.write(`Found ${lib.name} in cache: ${GLOBAL_CACHE_DIR}\n`);
      }
      continue;
    }

    // 3. Needs install
    needsInstall.push(lib.name);
  }

  // Auto-install missing packages
  if (needsInstall.length > 0) {
    if (!quiet) {
      process.stderr.write(
        `Installing ${needsInstall.length} package(s): ${needsInstall.join(', ')}...\n`,
      );
    }

    await npmInstallPackages(needsInstall, verbose);
    basePaths.add(GLOBAL_CACHE_DIR);

    // Verify installation
    const failed: string[] = [];
    for (const name of needsInstall) {
      if (isPackageInstalled(GLOBAL_CACHE_DIR, name)) {
        resolved.push(name);
      } else {
        failed.push(name);
      }
    }

    if (failed.length > 0) {
      return { basePaths: [...basePaths], resolved, failed };
    }
  }

  return { basePaths: [...basePaths], resolved, failed: [] };
}
