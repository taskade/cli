#!/usr/bin/env node

/**
 * @taskade/cli - Thin CLI for Taskade MCP plug-and-play.
 *
 * Commands:
 *   taskade plug [cursor|claude]  Print the MCP server config block for your client.
 *   taskade whoami               Verify your PAT works against the Taskade API.
 *   taskade help                  Show this help.
 *
 * Usage:
 *   npx @taskade/cli plug cursor    # copy-paste into Cursor's MCP config
 *   npx @taskade/cli whoami         # paste your tskdp_ token, verify it works
 *
 * Environment:
 *   TASKADE_TOKEN   Your Personal Access Token (tskdp_...). If unset, you will be
 *                   prompted to paste it. Get one at https://taskade.com/settings/api
 *   TASKADE_API_URL API base URL (default: https://www.taskade.com)
 */

const DEFAULT_API_URL = "https://www.taskade.com";
const MCP_SERVER_URL = "https://taskade.com/mcp";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a line from stdin (used for token prompt). */
function readLine() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      resolve(data.trim());
    });
  });
}

/** Get the token from env or prompt. */
async function getToken() {
  if (process.env.TASKADE_TOKEN) return process.env.TASKADE_TOKEN;
  process.stderr.write("Paste your Taskade PAT (tskdp_...): ");
  return readLine();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** `taskade plug [cursor|claude]` - print the MCP config block. */
async function cmdPlug(client) {
  const token = await getToken();
  if (!token) {
    process.stderr.write("No token provided. Get one at https://taskade.com/settings/api\n");
    process.exit(1);
  }

  const config = {
    mcpServers: {
      taskade: {
        url: MCP_SERVER_URL,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };

  const json = JSON.stringify(config, null, 2);

  if (client === "cursor") {
    // Cursor reads ~/.cursor/mcp.json or project .cursor/mcp.json
    process.stdout.write(`# Add this to your Cursor MCP config\n`);
    process.stdout.write(`# ~/.cursor/mcp.json  or  .cursor/mcp.json in your project\n\n`);
    process.stdout.write(json);
    process.stdout.write("\n");
  } else if (client === "claude") {
    // Claude Desktop / Claude Code reads claude_desktop_config.json
    process.stdout.write(`# Add this to your Claude config\n`);
    process.stdout.write(`# ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)\n`);
    process.stdout.write(`# or .mcp.json in your project root (Claude Code)\n\n`);
    process.stdout.write(json);
    process.stdout.write("\n");
  } else {
    // No client specified - just print the raw JSON
    process.stdout.write(json);
    process.stdout.write("\n");
  }
}

/** `taskade whoami` - verify the PAT works. */
async function cmdWhoami() {
  const token = await getToken();
  if (!token) {
    process.stderr.write("No token provided. Get one at https://taskade.com/settings/api\n");
    process.exit(1);
  }

  const apiUrl = process.env.TASKADE_API_URL || DEFAULT_API_URL;
  const url = `${apiUrl}/api/v2/user`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (res.status === 401) {
      process.stderr.write("Token is invalid or expired. Get a new one at https://taskade.com/settings/api\n");
      process.exit(1);
    }

    if (res.status === 403) {
      process.stderr.write("Token is valid but lacks access. Check your plan at https://taskade.com/settings/billing\n");
      process.exit(1);
    }

    if (!res.ok) {
      process.stderr.write(`API returned ${res.status} ${res.statusText}\n`);
      process.exit(1);
    }

    const data = await res.json();
    const name = data.full_name || data.name || data.email || "unknown";
    const email = data.email || "";
    process.stdout.write(`Token works.\n`);
    process.stdout.write(`  User:  ${name}\n`);
    if (email) process.stdout.write(`  Email: ${email}\n`);
    process.stdout.write(`  Plan:  ${data.plan || "unknown"}\n`);
    process.stdout.write(`\nMCP server URL: ${MCP_SERVER_URL}\n`);
  } catch (err) {
    process.stderr.write(`Request failed: ${err.message}\n`);
    process.exit(1);
  }
}

/** `taskade help` - show usage. */
function cmdHelp() {
  process.stdout.write(`
@taskade/cli - Thin CLI for Taskade MCP plug-and-play

USAGE
  taskade <command> [options]

COMMANDS
  plug [cursor|claude]   Print the MCP server config block for your client
  whoami                 Verify your PAT works against the Taskade API
  help                   Show this help message

EXAMPLES
  npx @taskade/cli plug cursor     # config block for Cursor
  npx @taskade/cli plug claude     # config block for Claude Desktop/Code
  npx @taskade/cli plug            # raw JSON, no client wrapper
  npx @taskade/cli whoami          # verify your token

ENVIRONMENT
  TASKADE_TOKEN     Your PAT (tskdp_...). Get one at https://taskade.com/settings/api
  TASKADE_API_URL   API base URL (default: https://www.taskade.com)

LEARN MORE
  Hosted MCP:  https://taskade.com/mcp
  API docs:    https://www.taskade.com/api/documentation/v2
  GitHub:      https://github.com/taskade/cli
`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "plug":
      await cmdPlug(args[0]);
      break;
    case "whoami":
      await cmdWhoami();
      break;
    case "help":
    case "--help":
    case "-h":
      cmdHelp();
      break;
    case undefined:
      cmdHelp();
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n`);
      cmdHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
