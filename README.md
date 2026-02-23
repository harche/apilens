# apilens

Teach AI agents to use npm libraries. Installs packages and generates skill files so agents read TypeScript types and execute code in a sandbox.


## Quick Start

```bash
# Install globally
npm install -g apilens

# Create a config in your project
cat > .apilens.yaml << 'EOF'
libraries:
  - name: "@kubernetes/client-node"
    title: "Kubernetes API client"
  - name: "pg"
    title: "Typescript library to interact with a Postgresql database"
EOF

# Install libraries and generate Claude Code skill files
apilens setup
```

That single command:
1. Installs the configured libraries into your project's `node_modules/`
2. Generates `.claude/skills/apilens/SKILL.md` with per-library reference files

Start Claude Code — it will auto-discover the skill and use `apilens` to find APIs before writing code.

## CLI Reference

```
apilens <command> [options]

COMMANDS:
  setup                Install libraries and generate Claude Code skill files
  exec <file.ts>       Execute TypeScript in a sandboxed environment (file or stdin)

SETUP OPTIONS:
  --dir <path>         Output directory for skill files (default: .claude/skills/apilens)

EXEC OPTIONS:
  --timeout <ms>       Execution timeout in milliseconds (default: 30000)

GLOBAL OPTIONS:
  --config <path>      Path to config file
  --verbose            Debug output on stderr
  -q, --quiet          Suppress stderr
  -h, --help           Show help
  -v, --version        Show version
```

## Configuration

### Config file format

```yaml
libraries:
  - name: "@kubernetes/client-node"
    title: "Kubernetes API client"
  - name: "pg"
    title: "Typescript library to interact with a Postgresql database"
    description: >-
      PostgreSQL client for Node.js. Connect to the PostgreSQL server running in the cluster.
      Quick start: `const { Client } = require("pg"); const client = new Client({ host: "postgresql.prodisco.svc.cluster.local", port: 5432, user: "prodisco", password: "prodisco", database: "prodisco" }); await client.connect();`
      Queries: `const res = await client.query("SELECT * FROM my_table");` returns `{ rows, rowCount, fields }`.
      Parameterized: `await client.query("INSERT INTO users(name, age) VALUES($1, $2)", ["alice", 30]);`
      Always call `await client.end();` when done.
      IMPORTANT: Before querying or modifying any table, ALWAYS discover the schema first. List tables with
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'` and inspect columns with
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'my_table'`.
      Never assume column names or types exist — verify them first.
```

Each library requires:
- `name` — the npm package name
- `title` — a one-line description used in the SKILL.md description (helps Claude decide when to invoke the skill)

The optional `description` field provides detailed context that goes into the per-library reference files. Use it to give the agent quick-start instructions: connection strings, common queries, important caveats, and workflow patterns. Multi-line descriptions (using YAML `>-` or `|`) are passed through to the generated reference files.

### Config discovery

Priority order:
1. `--config <path>` flag
2. `APILENS_CONFIG` environment variable
3. `.apilens.yaml` / `.apilens.yml` / `.apilens.json` — walks upward from CWD

## JSON Output

All commands write JSON to stdout. Diagnostic/progress output goes to stderr.

## Claude Code Integration

`apilens setup` generates a Claude Code skill file at `.claude/skills/apilens/SKILL.md` that:

- Lists all configured libraries in the skill description (always in Claude's context)
- Creates per-library reference files in `references/` (loaded on demand)
- Grants `Bash(apilens:*)`, `Bash(npx tsx:*)`, and `Write` tool permissions
- Instructs the agent to browse APIs → write script → execute (not just explain APIs)

Use `--dir` to write skill files to a custom directory instead of the default `.claude/skills/apilens/`:

```bash
# Write to a custom location
apilens setup --dir container/skills/apilens

# Absolute path (apilens/ is appended automatically if not present)
apilens setup --dir /path/to/skills
```

When `--dir` is used, the `.agents/skills/` Codex symlink is skipped since it only applies to the default Claude Code layout.

## Development

```bash
# Install dependencies
npm install

# Run in development
npx tsx src/cli.ts setup

# Build
npm run build

# Test
npm test
```

## License

MIT
