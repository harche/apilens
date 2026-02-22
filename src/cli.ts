#!/usr/bin/env node
import minimist from 'minimist';
import type { CLIArgs } from './types.js';
import { loadConfig } from './config.js';
import { searchCommand } from './commands/search.js';
import { listCommand } from './commands/list.js';
import { indexCommand } from './commands/index-cmd.js';
import { installCommand } from './commands/install.js';
import { execCommand } from './commands/exec.js';

const VERSION = '0.1.0';

const HELP_TEXT = `
apilens - Discover TypeScript library APIs from the command line

USAGE:
  apilens <command> [options]

COMMANDS:
  search [query]       Search for API methods, types, and functions
  list                 List configured/indexed libraries
  index                Pre-build search index for all configured libraries
  install --skills     Install Claude Code skill files into project
  exec <file.ts>       Execute TypeScript in a sandboxed environment (file or stdin)

SEARCH OPTIONS:
  <query>              Free-text search (positional, after "search")
  -m, --method <name>  Search by method/function name
  -l, --library <lib>  Filter by library (default: all configured)
  -t, --type <type>    method | type | function | all (default: all)
  -c, --category <cat> Filter by category (list, create, delete, read, patch...)
  -n, --limit <n>      Max results (default: 10)
  --offset <n>         Skip N results (default: 0)

EXEC OPTIONS:
  --timeout <ms>       Execution timeout in milliseconds (default: 30000)

GLOBAL OPTIONS:
  --config <path>      Path to config file
  --verbose            Debug output on stderr
  -q, --quiet          Suppress stderr
  -h, --help           Show help
  -v, --version        Show version

EXAMPLES:
  apilens search "list pods" -l @kubernetes/client-node -t method
  apilens search -m listNamespacedPod -l @kubernetes/client-node
  apilens search V1Pod -t type -n 5
  apilens list
  apilens install --skills
  apilens exec script.ts
  apilens exec - <<'SCRIPT'
    const lib = require("my-lib");
    console.log(await lib.doSomething());
  SCRIPT
  apilens exec script.ts --timeout 60000
`.trimStart();

function parseArgs(argv: string[]): CLIArgs {
  const parsed = minimist(argv.slice(2), {
    string: ['method', 'library', 'type', 'category', 'config'],
    boolean: ['verbose', 'quiet', 'help', 'version', 'skills'],
    alias: {
      m: 'method',
      l: 'library',
      t: 'type',
      c: 'category',
      n: 'limit',
      q: 'quiet',
      h: 'help',
      v: 'version',
    },
    default: {
      limit: 10,
      offset: 0,
      verbose: false,
      quiet: false,
      help: false,
      version: false,
      skills: false,
      timeout: 30000,
    },
  });

  const positional = parsed._ as string[];
  const command = positional[0] as string | undefined ?? '';
  const rest = positional.slice(1);

  // For search command, join remaining positional args as the query
  const query = rest.length > 0 ? rest.join(' ') : undefined;

  return {
    command,
    positional: rest,
    query,
    method: parsed['method'] as string | undefined,
    library: parsed['library'] as string | undefined,
    type: parsed['type'] as string | undefined,
    category: parsed['category'] as string | undefined,
    limit: Number(parsed['limit']) || 10,
    offset: Number(parsed['offset']) || 0,
    config: parsed['config'] as string | undefined,
    verbose: Boolean(parsed['verbose']),
    quiet: Boolean(parsed['quiet']),
    help: Boolean(parsed['help']),
    version: Boolean(parsed['version']),
    skills: Boolean(parsed['skills']),
    timeout: Number(parsed['timeout']) || 30000,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.version) {
    process.stdout.write(`apilens v${VERSION}\n`);
    return;
  }

  if (args.help || !args.command) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  switch (args.command) {
    case 'search': {
      const config = loadConfig(args);
      await searchCommand(args, config);
      break;
    }

    case 'list': {
      const config = loadConfig(args);
      await listCommand(args, config);
      break;
    }

    case 'index': {
      const config = loadConfig(args);
      await indexCommand(args, config);
      break;
    }

    case 'install': {
      const config = loadConfig(args);
      await installCommand(args, config);
      break;
    }

    case 'exec': {
      const config = loadConfig(args);
      await execCommand(args, config);
      break;
    }

    default:
      process.stderr.write(`Unknown command: ${args.command}\n`);
      process.stdout.write(HELP_TEXT);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
