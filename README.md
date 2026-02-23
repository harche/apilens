# apilens

CLI for AI agents to discover TypeScript library APIs. Agents search for methods, types, and functions, get structured JSON output, then write and execute code using their native tools.

No sandbox, no gRPC, no MCP. Just API discovery.

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

# Install libraries, build search index, and generate Claude Code skill files
apilens install --skills
```

That single command:
1. Installs the configured libraries into your project's `node_modules/`
2. Builds the search index (extracts types from `.d.ts` files)
3. Generates `.claude/skills/apilens/SKILL.md` with per-library reference files

Start Claude Code — it will auto-discover the skill and use `apilens` to find APIs before writing code.

## How It Works

apilens wraps [`@prodisco/search-libs`](https://www.npmjs.com/package/@prodisco/search-libs) to extract and index TypeScript declaration files (`.d.ts`) from npm packages. It provides full-text search over methods, types, and functions with structured JSON output on stdout.

```
┌─────────────┐     ┌──────────┐     ┌───────────────────┐
│ .apilens.yaml│────▶│ apilens  │────▶│ @prodisco/search- │
│ (config)    │     │  CLI     │     │ libs (indexer)    │
└─────────────┘     └────┬─────┘     └───────────────────┘
                         │
                    JSON on stdout
                         │
                    ┌────▼─────┐
                    │ AI Agent │
                    │ (Claude) │
                    └──────────┘
```

## CLI Reference

```
apilens <command> [options]

COMMANDS:
  search [query]       Search for API methods, types, and functions
  list                 List configured/indexed libraries
  index                Pre-build search index for all configured libraries
  install --skills     Install libraries, build index, generate Claude Code skill files

SEARCH OPTIONS:
  <query>              Free-text search (positional, after "search")
  -m, --method <name>  Search by method/function name
  -l, --library <lib>  Filter by library (default: all configured)
  -t, --type <type>    method | type | function | all (default: all)
  -c, --category <cat> Filter by category (list, create, delete, read, patch...)
  -n, --limit <n>      Max results (default: 10)
  --offset <n>         Skip N results (default: 0)

INSTALL OPTIONS:
  --dir <path>         Output directory for skill files (default: .claude/skills/apilens)

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

If no config is found, use `-l <library>` for ad-hoc single-library searches.

## Search Examples

```bash
# Free-text search across all libraries
apilens search "create connection"

# Filter by library and type
apilens search "query" -l pg -t method

# Search by exact method name
apilens search -m createPool -l pg

# Browse methods by category
apilens search -l pg -c create -t method -n 20

# Search for types/interfaces
apilens search "PoolConfig" -l pg -t type

# Pagination
apilens search "get" -l ioredis --offset 10 -n 10
```

## JSON Output

All commands write JSON to stdout. Diagnostic/progress output goes to stderr.

```json
{
  "summary": "Showing 3 of 42 results.",
  "results": [
    {
      "id": "method:pg:Client:query",
      "type": "method",
      "name": "query",
      "library": "pg",
      "category": "read",
      "description": "Execute a SQL query",
      "className": "Client",
      "parameters": [
        { "name": "queryText", "type": "string", "optional": false }
      ],
      "returnType": "Promise<QueryResult>",
      "signature": "query(queryText: string, ...): Promise<QueryResult>"
    }
  ],
  "totalMatches": 42,
  "facets": {
    "documentType": { "method": 30, "type": 10, "function": 2 },
    "library": { "pg": 42 },
    "category": { "read": 8, "create": 6 }
  },
  "pagination": { "offset": 0, "limit": 10, "hasMore": true },
  "searchTimeMs": 1.23
}
```

## Package Resolution

apilens resolves packages in this order:
1. Project `node_modules/` (walks upward from CWD)
2. Global cache at `~/.apilens/packages/`
3. Auto-installs missing packages (to the project during `install --skills`, to the global cache during `search`)

## Claude Code Integration

`apilens install --skills` generates a Claude Code skill file at `.claude/skills/apilens/SKILL.md` that:

- Lists all configured libraries in the skill description (always in Claude's context)
- Creates per-library reference files in `references/` (loaded on demand)
- Grants `Bash(apilens:*)`, `Bash(npx tsx:*)`, and `Write` tool permissions
- Instructs the agent to search → write script → execute (not just explain APIs)

Use `--dir` to write skill files to a custom directory instead of the default `.claude/skills/apilens/`:

```bash
# Write to a custom location
apilens install --skills --dir container/skills/apilens

# Absolute path (apilens/ is appended automatically if not present)
apilens install --skills --dir /path/to/skills
```

When `--dir` is used, the `.agents/skills/` Codex symlink is skipped since it only applies to the default Claude Code layout.

## Development

```bash
# Install dependencies
npm install

# Run in development
npx tsx src/cli.ts search "query" -l some-lib

# Build
npm run build

# Test
npm test
```

## License

MIT
