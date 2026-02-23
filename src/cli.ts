#!/usr/bin/env node
import minimist from 'minimist';
import type { CLIArgs } from './types.js';
import { loadConfig } from './config.js';
import { setupCommand } from './commands/setup.js';
import { execCommand } from './commands/exec.js';

const VERSION = '0.1.0';

const HELP_TEXT = `
apilens - Discover TypeScript library APIs from the command line

USAGE:
  apilens <command> [options]

COMMANDS:
  setup                Install libraries and generate Claude Code skill files
  exec <file.ts>       Execute TypeScript in a sandboxed environment (file or stdin)

SETUP OPTIONS:
  --config <path>      Path to config file (default: APILENS_CONFIG env var,
                       or .apilens.{yaml,yml,json} walking upward from CWD)
  --dir <path>         Output directory for skill files (default: .claude/skills/apilens)

EXEC OPTIONS:
  --timeout <ms>       Execution timeout in milliseconds (default: 30000)

GLOBAL OPTIONS:
  --verbose            Debug output on stderr
  -q, --quiet          Suppress stderr
  -h, --help           Show help
  -v, --version        Show version

EXAMPLES:
  apilens setup
  apilens exec script.ts
  apilens exec - <<'SCRIPT'
    const lib = require("my-lib");
    console.log(await lib.doSomething());
  SCRIPT
  apilens exec script.ts --timeout 60000
`.trimStart();

function parseArgs(argv: string[]): CLIArgs {
  const parsed = minimist(argv.slice(2), {
    string: ['config', 'dir'],
    boolean: ['verbose', 'quiet', 'help', 'version'],
    alias: {
      q: 'quiet',
      h: 'help',
      v: 'version',
    },
    default: {
      verbose: false,
      quiet: false,
      help: false,
      version: false,
      timeout: 30000,
    },
  });

  const positional = parsed._ as string[];
  const command = positional[0] as string | undefined ?? '';
  const rest = positional.slice(1);

  return {
    command,
    positional: rest,
    config: parsed['config'] as string | undefined,
    verbose: Boolean(parsed['verbose']),
    quiet: Boolean(parsed['quiet']),
    help: Boolean(parsed['help']),
    version: Boolean(parsed['version']),
    timeout: Number(parsed['timeout']) || 30000,
    dir: parsed['dir'] as string | undefined,
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
    case 'setup': {
      const config = loadConfig(args);
      await setupCommand(args, config);
      break;
    }

    case 'exec': {
      await execCommand(args);
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
