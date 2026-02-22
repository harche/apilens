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
    description: "Kubernetes API client"
  - name: "pg"
    description: "PostgreSQL client for Node.js"
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
    description: "Kubernetes API client"
  - name: "pg"
    description: |
      PostgreSQL client for Node.js.
      Quick start: const { Client } = require('pg'); const client = new Client();
      Workflow: (1) create client (2) client.connect() (3) client.query('SELECT ...')
  - name: "ioredis"
    description: "Redis client with cluster support"
```

Multi-line descriptions (using YAML `|`) are passed through to the generated skill files so the agent has quick-start context for each library.

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
