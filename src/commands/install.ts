import fs from 'node:fs';
import path from 'node:path';
import type { CLIArgs, ApilensConfig, LibrarySpec } from '../types.js';
import { resolvePackages, installPackagesLocally } from '../resolver.js';
import { getIndexer, shutdownIndexer } from '../indexer.js';
import { writeOutput, writeError } from '../output.js';

/**
 * Sanitize a library name into a valid filename.
 * "@kubernetes/client-node" → "kubernetes-client-node"
 */
function libToFilename(name: string): string {
  return name.replace(/^@/, '').replace(/\//g, '-');
}

/**
 * Format library list for the SKILL.md body.
 */
function formatLibraryList(libraries: LibrarySpec[]): string {
  return libraries
    .map((lib) => {
      const refFile = `references/${libToFilename(lib.name)}.md`;
      const desc = lib.description ? ` — ${lib.description.split('\n')[0]!.trim()}` : '';
      return `- **[${lib.name}](${refFile})**${desc}`;
    })
    .join('\n');
}

/**
 * Generate the SKILL.md content from config.
 */
function generateSkillMd(config: ApilensConfig): string {
  const libraryNames = config.libraries.map((l) => l.name);
  const firstLib = libraryNames[0] ?? 'my-lib';

  return `---
name: apilens
description: >-
  Discovers API methods, types, and functions from TypeScript/npm libraries.
  Use when you need to find the right API method, understand method signatures,
  parameter types, or return types before writing code that calls a library.
  Available libraries: ${libraryNames.join(', ')}.
  IMPORTANT: After discovering APIs, always write a .ts script file and execute it with npx tsx.
allowed-tools: Bash(apilens:*), Bash(npx tsx:*), Write
---

# apilens — API Discovery

**ALWAYS search before writing code, then write a script and execute it.**

All configured libraries are pre-installed in this project's node_modules.

## Available Libraries

${formatLibraryList(config.libraries)}

## Search Commands

\`\`\`bash
# Free-text search (searches all configured libraries)
apilens search "<your query>"

# Filter by a specific library
apilens search "<query>" -l <library> -t method

# Search by exact method/function name
apilens search -m <methodName> -l <library>

# Filter by category (list, create, delete, read, patch...)
apilens search -l <library> -c list -t method -n 20

# Search for types/interfaces
apilens search "<type name>" -t type -n 5

# Pagination
apilens search "<query>" -l <library> --offset 10 -n 10

# List configured libraries
apilens list
\`\`\`

## Workflow

1. **Search** for the API: \`apilens search "<what you want to do>" -l <library> -t method\`
2. **Write a .ts script** using the discovered method signatures — use the Write tool to create the file
3. **Execute it**: \`npx tsx <script>.ts\`

Do NOT just explain the API — always write a .ts script and execute it. All configured libraries are pre-installed in this project's node_modules.

### Example

User asks to do something with a configured library:

Step 1 — Search for the right method:
\`\`\`bash
apilens search "<what you want to do>" -l <library> -t method -n 5
\`\`\`

Step 2 — Use the Write tool to create a .ts script using the discovered signatures.

Step 3 — Execute the script:
\`\`\`bash
npx tsx <script>.ts
\`\`\`

If the script fails, check the error, search for the correct types or parameters, fix the script, and re-run.
`;
}

/**
 * Generate a per-library reference file.
 */
function generateLibraryReference(lib: LibrarySpec): string {
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

  lines.push('## Searching this library');
  lines.push('');
  lines.push('```bash');
  lines.push(`# Search methods`);
  lines.push(`apilens search "<query>" -l ${lib.name} -t method`);
  lines.push('');
  lines.push(`# Search types/interfaces`);
  lines.push(`apilens search "<type name>" -l ${lib.name} -t type`);
  lines.push('');
  lines.push(`# Search functions`);
  lines.push(`apilens search "<query>" -l ${lib.name} -t function`);
  lines.push('');
  lines.push(`# Browse by category`);
  lines.push(`apilens search -l ${lib.name} -c list -t method -n 20`);
  lines.push(`apilens search -l ${lib.name} -c create -t method -n 20`);
  lines.push(`apilens search -l ${lib.name} -c delete -t method -n 20`);
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

export async function installCommand(args: CLIArgs, config: ApilensConfig): Promise<void> {
  if (!args.skills) {
    writeError('Use --skills to install Claude Code skill files.');
    process.exitCode = 1;
    return;
  }

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

    // 3. Pre-build the search index so first search from Claude is fast
    if (!args.quiet) {
      process.stderr.write('Building search index...\n');
    }

    const indexer = await getIndexer(config, resolvedPaths, {
      verbose: args.verbose,
    });

    const indexResult = await indexer.search({ query: '', limit: 0 });

    if (!args.quiet) {
      process.stderr.write(`Indexed ${indexResult.totalMatches} items\n`);
    }

    await shutdownIndexer();

    // 4. Generate skill files from config
    const targetDir = path.join(process.cwd(), '.claude', 'skills', 'apilens');
    const refsDir = path.join(targetDir, 'references');
    fs.mkdirSync(refsDir, { recursive: true });

    const written: string[] = [];

    const skillMd = generateSkillMd(config);
    const skillPath = path.join(targetDir, 'SKILL.md');
    fs.writeFileSync(skillPath, skillMd, 'utf-8');
    written.push(skillPath);

    for (const lib of config.libraries) {
      const refContent = generateLibraryReference(lib);
      const refPath = path.join(refsDir, `${libToFilename(lib.name)}.md`);
      fs.writeFileSync(refPath, refContent, 'utf-8');
      written.push(refPath);
    }

    if (!args.quiet) {
      process.stderr.write(`Generated ${written.length} skill file(s) in ${targetDir}\n`);
    }

    writeOutput({
      message: 'Skill files installed successfully',
      destination: targetDir,
      files: written.map((f) => path.relative(process.cwd(), f)),
      libraries: config.libraries.map((l) => l.name),
      indexed: indexResult.totalMatches,
      facets: indexResult.facets,
    });
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
