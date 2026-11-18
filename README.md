# @taskade/cli

Thin CLI for Taskade MCP plug-and-play. It prints the config block that connects Cursor or Claude Code to your Taskade workspace with a personal access token.

> **Not on npm yet.** The package `@taskade/cli` is not published, so `npx @taskade/cli` fails. Run the CLI from GitHub with `npx github:taskade/cli`.

Most clients do not need this CLI or a token. They connect to `https://www.taskade.com/mcp` and sign in with OAuth. See [taskade/mcp](https://github.com/taskade/mcp) for the steps for each client. Use this CLI when a client cannot sign in with OAuth.

## Quick Start

```bash
# 1. Create a personal access token at https://www.taskade.com/settings/api (it starts with tskdp_)

# 2. Connect Cursor
npx github:taskade/cli plug cursor

# 3. Connect Claude Code
npx github:taskade/cli plug claude
```

## What This Does

This CLI prints the MCP server config block you need to paste into your AI agent client (Cursor or Claude Code). The block holds your token. Do not commit a file that holds your token.

**The token is the product.** You do not need this CLI to use Taskade MCP - you can copy the config block manually from [https://www.taskade.com/settings/api](https://www.taskade.com/settings/api). This CLI just makes it one command instead of five clicks.

## Commands

### `taskade plug [cursor|claude]`

Prints the MCP server config block.

```bash
npx github:taskade/cli plug cursor   # Cursor format with instructions
npx github:taskade/cli plug claude   # Claude Code format with instructions
npx github:taskade/cli plug          # Raw JSON, no client wrapper
```

Output (raw JSON):

```json
{
  "mcpServers": {
    "taskade": {
      "url": "https://www.taskade.com/mcp",
      "headers": {
        "Authorization": "Bearer tskdp_..."
      }
    }
  }
}
```

`plug claude` adds `"type": "http"` to the block. Claude Code needs this field for a remote server.

For Claude Desktop, add `https://www.taskade.com/mcp` in **Settings > Connectors** and sign in. Claude Desktop does not need a token.

### `taskade whoami`

> **This command does not work today.** It calls `GET /api/v2/user`, and the Taskade public API has no such path. The command prints `API returned 404 Not Found` for every token.

```bash
npx github:taskade/cli whoami
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TASKADE_TOKEN` | (prompt) | Your personal access token (`tskdp_...`). Create one at [https://www.taskade.com/settings/api](https://www.taskade.com/settings/api) |
| `TASKADE_API_URL` | `https://www.taskade.com` | API base URL for `whoami` |

## Requirements

- Node.js 18+ (uses built-in `fetch`)

## Hosted MCP and the local package

| | Hosted MCP | Local package (stdio) |
|---|-----------|-------------|
| Run | `https://www.taskade.com/mcp` | `npx @taskade/mcp-server` |
| Auth | OAuth sign-in, or a personal access token (`tskdp_...`) | Personal access token (`tskdp_...`) |
| Plan | Every paid plan | See [taskade/mcp](https://github.com/taskade/mcp) |
| Best for | Clients that support remote servers | Clients that support only stdio servers |

Both need network access to taskade.com. The local package calls the Taskade public API. [taskade/mcp](https://github.com/taskade/mcp) lists the tools of each.

**Use hosted MCP** when your client supports remote servers.

## Related

- [Hosted MCP](https://www.taskade.com/mcp) - the server this CLI configures
- [API v2 docs](https://www.taskade.com/api/documentation/v2) - the REST API the MCP wraps
- [taskade/mcp](https://github.com/taskade/mcp) - the MCP server repo
- [taskade/docs](https://github.com/taskade/docs) - developer documentation

## License

MIT
