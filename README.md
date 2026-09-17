# @taskade/cli

Thin CLI for Taskade MCP plug-and-play. One command to connect Cursor or Claude to your Taskade workspace.

## Quick Start

```bash
# 1. Get your token at https://taskade.com/settings/api (looks like tskdp_...)

# 2. Connect Cursor
npx @taskade/cli plug cursor

# 3. Connect Claude
npx @taskade/cli plug claude

# 4. Verify your token works
npx @taskade/cli whoami
```

## What This Does

This CLI prints the MCP server config block you need to paste into your AI agent client (Cursor, Claude Desktop, Claude Code). It also verifies your Personal Access Token (PAT) works against the Taskade API.

**The token is the product.** You do not need this CLI to use Taskade MCP - you can copy the config block manually from [https://taskade.com/settings/api](https://taskade.com/settings/api). This CLI just makes it one command instead of five clicks.

## Commands

### `taskade plug [cursor|claude]`

Prints the MCP server config block.

```bash
npx @taskade/cli plug cursor   # Cursor format with instructions
npx @taskade/cli plug claude   # Claude Desktop/Code format with instructions
npx @taskade/cli plug          # Raw JSON, no client wrapper
```

Output (raw JSON):

```json
{
  "mcpServers": {
    "taskade": {
      "url": "https://taskade.com/mcp",
      "headers": {
        "Authorization": "Bearer tskdp_..."
      }
    }
  }
}
```

### `taskade whoami`

Verifies your PAT works against the Taskade API.

```bash
npx @taskade/cli whoami
```

Output:

```
Token works.
  User:  John Doe
  Email: john@example.com
  Plan:  pro

MCP server URL: https://taskade.com/mcp
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TASKADE_TOKEN` | (prompt) | Your PAT (`tskdp_...`). Get one at [https://taskade.com/settings/api](https://taskade.com/settings/api) |
| `TASKADE_API_URL` | `https://www.taskade.com` | API base URL (for self-hosted) |

## Requirements

- Node.js 18+ (uses built-in `fetch`)

## Hosted MCP vs stdio

| | Hosted MCP | stdio (npm) |
|---|-----------|-------------|
| URL | `https://taskade.com/mcp` | `npx @taskade/mcp-server` |
| Auth | PAT (`tskdp_...`) | PAT (`tskdp_...`) |
| Tools | 48 (44 Phase A + 4 native) | 14 (read-only subset) |
| Plan | Starter+ | Any |
| Best for | Cursor, Claude Desktop, Claude Code | Local stdio wrapper |

**Use hosted MCP.** It has 3x more tools (including writes) and is maintained. The stdio wrapper is a local fallback only.

## Related

- [Hosted MCP](https://taskade.com/mcp) - the server this CLI configures
- [API v2 docs](https://www.taskade.com/api/documentation/v2) - the REST API the MCP wraps
- [taskade/mcp](https://github.com/taskade/mcp) - the MCP server repo
- [taskade/docs](https://github.com/taskade/docs) - developer documentation

## License

MIT
