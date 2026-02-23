import fs from 'node:fs';
import path from 'node:path';
import type { CLIArgs, ApilensConfig, LibrarySpec } from '../types.js';
import { resolvePackages, installPackagesLocally } from '../resolver.js';
import { writeOutput, writeError } from '../output.js';

/**
 * Sanitize a library name into a valid filename.
 * "@kubernetes/client-node" → "kubernetes-client-node"
 */
function libToFilename(name: string): string {
  return name.replace(/^@/, '').replace(/\//g, '-');
}

/**
 * Find the package directory for a given package name across resolved base paths.
 */
function findPackageDir(basePaths: string[], packageName: string): string | null {
  for (const basePath of basePaths) {
    const dir = packageName.startsWith('@')
      ? path.join(basePath, 'node_modules', ...packageName.split('/'))
      : path.join(basePath, 'node_modules', packageName);
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return null;
}

/**
 * Format library list for the SKILL.md body.
 */
/**
 * Generate the SKILL.md content from config.
 */
function generateSkillMd(config: ApilensConfig, modulePaths: Map<string, string>): string {
  const libraryNames = config.libraries.map((l) => l.name);
  const firstLib = libraryNames[0] ?? 'my-lib';
  const firstLibPath = modulePaths.get(firstLib) ?? `node_modules/${firstLib}`;

  const libraryList = config.libraries
    .map((l) => {
      const modPath = modulePaths.get(l.name);
      const pathSuffix = modPath ? ` -> ${modPath}` : '';
      return `${l.name} (${l.title})${pathSuffix}`;
    })
    .join('; ');

  return `---
name: apilens
description: >-
  Provides access to TypeScript/npm libraries for code execution:
  ${libraryList}.
  Use when you need to understand library APIs, method signatures,
  parameter types, or return types before writing code.
  Read the library's type declarations at the module path to understand the API.
  IMPORTANT: After reading the API, execute code inline with apilens exec using a heredoc.
allowed-tools: Bash(apilens:*)
---

# apilens — API Discovery

**ALWAYS read the library's type declarations before writing code, then execute code inline.**

Sandbox provides console + process.env and restricts require() to an allowlist.
IMPORTANT: Use \`require()\` syntax, NOT \`import\` statements.

## Library References (MUST READ before writing code)

${config.libraries.map((lib) => `- [${lib.name}](references/${libToFilename(lib.name)}.md)`).join('\n')}

## Workflow

1. **Read** the library's type declarations. Open the per-library reference file (linked above) to find the module path, then:
   - Read \`package.json\` in the module directory to find the \`types\` or \`typings\` entry point
   - Read the entry \`.d.ts\` file to understand the API surface
   - Follow imports to read related type files as needed
2. **Execute** code inline using the discovered API:

\`\`\`bash
apilens exec - <<'SCRIPT'
const lib = require("${firstLib}");
// ... use the API you learned from reading the types
console.log(result);
SCRIPT
\`\`\`

Do NOT write a file — submit code directly via heredoc. Do NOT use \`import\` syntax — use \`require()\`.

### Example

User asks to do something with \`${firstLib}\`:

Step 1 — Read the type declarations:
- Open \`${firstLibPath}/package.json\` to find the \`types\` entry point
- Read the \`.d.ts\` files to understand available methods, parameters, and return types

Step 2 — Execute inline:
\`\`\`bash
apilens exec - <<'SCRIPT'
const lib = require("${firstLib}");
// use the API you learned from the type declarations
const result = await lib.someMethod();
console.log(result);
SCRIPT
\`\`\`

If the script fails, re-read the types to check correct parameters and try again.
`;
}

/**
 * Generate a per-library reference file.
 */
function generateLibraryReference(lib: LibrarySpec, modulePath: string | null): string {
  const lines: string[] = [];

  lines.push(`# ${lib.name}`);
  lines.push('');

  if (lib.description) {
    const descLines = lib.description.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    for (const line of descLines) {
      lines.push(line);
    }
    lines.push('');
  }

  lines.push('## Module path');
  lines.push('');
  if (modulePath) {
    lines.push(`\`${modulePath}\``);
    lines.push('');
    lines.push(`Read \`${modulePath}/package.json\` to find the \`types\` or \`typings\` entry point.`);
    lines.push('Then read the entry \`.d.ts\` file and follow imports to understand the API.');
  } else {
    lines.push('Module path could not be resolved. Run `apilens setup` to install the package.');
  }
  lines.push('');

  return lines.join('\n');
}

export async function setupCommand(args: CLIArgs, config: ApilensConfig): Promise<void> {
  try {
    // 1. Install packages into the project so the agent can import them at runtime
    if (!args.quiet) {
      process.stderr.write('Installing packages...\n');
    }

    const installResult = await installPackagesLocally(config, process.cwd(), {
      verbose: args.verbose,
      quiet: args.quiet,
    });

    // 2. Resolve packages for indexing (now they'll be found in project node_modules)
    const resolvedPaths = await resolvePackages(config, {
      verbose: args.verbose,
      quiet: args.quiet,
    });

    if (resolvedPaths.failed.length > 0) {
      process.stderr.write(
        `Warning: Failed to resolve: ${resolvedPaths.failed.join(', ')}\n`,
      );
    }

    if (resolvedPaths.resolved.length === 0) {
      writeError('No packages could be resolved.');
      process.exitCode = 1;
      return;
    }

    // 3. Compute module paths for each library
    const modulePaths = new Map<string, string>();
    for (const lib of config.libraries) {
      if (!resolvedPaths.resolved.includes(lib.name)) continue;
      const pkgDir = findPackageDir(resolvedPaths.basePaths, lib.name);
      if (pkgDir) {
        modulePaths.set(lib.name, pkgDir);
      }
    }

    // 4. Generate skill files from config
    let targetDir: string;
    if (args.dir) {
      const resolved = path.resolve(args.dir);
      targetDir = resolved.endsWith('apilens') ? resolved : path.join(resolved, 'apilens');
    } else {
      targetDir = path.join(process.cwd(), '.claude', 'skills', 'apilens');
    }
    const refsDir = path.join(targetDir, 'references');
    fs.mkdirSync(refsDir, { recursive: true });

    const written: string[] = [];

    // Create a binstub so Claude Code can find apilens relative to the skill dir
    const binDir = path.join(targetDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const binstubPath = path.join(binDir, 'apilens');
    fs.writeFileSync(binstubPath, '#!/bin/sh\nexec apilens "$@"\n', { mode: 0o755 });
    written.push(binstubPath);

    const skillMd = generateSkillMd(config, modulePaths);
    const skillPath = path.join(targetDir, 'SKILL.md');
    fs.writeFileSync(skillPath, skillMd, 'utf-8');
    written.push(skillPath);

    for (const lib of config.libraries) {
      const refContent = generateLibraryReference(lib, modulePaths.get(lib.name) ?? null);
      const refPath = path.join(refsDir, `${libToFilename(lib.name)}.md`);
      fs.writeFileSync(refPath, refContent, 'utf-8');
      written.push(refPath);
    }

    // Symlink for Codex / Gemini CLI: .agents/skills/apilens → .claude/skills/apilens
    // Both Codex and Gemini CLI discover skills from .agents/skills/
    // Only create when using the default directory layout
    if (!args.dir) {
      const agentsDir = path.join(process.cwd(), '.agents', 'skills');
      fs.mkdirSync(agentsDir, { recursive: true });
      const link = path.join(agentsDir, 'apilens');
      try {
        const existing = fs.readlinkSync(link);
        if (existing !== targetDir) {
          fs.unlinkSync(link);
          fs.symlinkSync(targetDir, link, 'dir');
        }
      } catch {
        // No existing symlink — create it
        fs.symlinkSync(targetDir, link, 'dir');
      }
      written.push(link);
    }

    if (!args.quiet) {
      process.stderr.write(`Generated ${written.length} skill file(s) in ${targetDir}\n`);
    }

    writeOutput({
      message: 'Skill files installed successfully',
      destination: targetDir,
      files: written.map((f) => path.relative(process.cwd(), f)),
      libraries: config.libraries.map((l) => l.name),
      modulePaths: Object.fromEntries(modulePaths),
    });
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
