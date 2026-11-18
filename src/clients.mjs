// The MCP clients that this CLI supports, how to find them on the machine,
// and where each one keeps its MCP servers. Each client cites the public
// documentation that shows its config shape and file location.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readConfig } from "./config-file.mjs";
import { exists, getEnv, homeDir, which } from "./system.mjs";

export const SERVER_NAME = "taskade";
export const DEFAULT_SERVER_URL = "https://www.taskade.com/mcp";
// The command that runs this CLI. Change it to `npx @taskade/cli` after the first npm release.
export const RUN = "npx @taskade/cli";
export const TOKEN_PAGE = "https://www.taskade.com/settings/api";

/**
 * The server URL: TASKADE_MCP_URL, or the hosted Taskade server.
 * Only https is allowed, except for localhost and 127.0.0.1 (for tests).
 */
export function serverUrl(io) {
  const raw = getEnv(io.env, "TASKADE_MCP_URL") || DEFAULT_SERVER_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`TASKADE_MCP_URL is not a URL: ${raw}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`The server URL must use https:// (http:// only for localhost or 127.0.0.1): ${raw}`);
  }
  return raw;
}

export const CLIENTS = [
  {
    id: "claude-code",
    name: "Claude Code",
    aliases: ["claude"],
    // Command, scopes, ~/.claude.json and .mcp.json: https://code.claude.com/docs/en/mcp
    docs: "https://code.claude.com/docs/en/mcp",
    detect: (io) => Boolean(which(io, "claude")),
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    aliases: [],
    // A remote server is a custom connector in the app, not an entry in a file:
    // https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
    docs: "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp",
    detect: (io) => {
      if (io.platform === "darwin") return exists(join(homeDir(io), "Library", "Application Support", "Claude"));
      if (io.platform === "win32") {
        const appData = getEnv(io.env, "APPDATA");
        return Boolean(appData) && exists(join(appData, "Claude"));
      }
      return false;
    },
  },
  {
    id: "cursor",
    name: "Cursor",
    aliases: [],
    // ~/.cursor/mcp.json and .cursor/mcp.json, a remote server has "url": https://cursor.com/docs/context/mcp
    docs: "https://cursor.com/docs/context/mcp",
    detect: (io) => Boolean(which(io, "cursor")) || exists(join(homeDir(io), ".cursor")),
  },
  {
    id: "codex",
    name: "Codex",
    aliases: [],
    // `codex mcp add <name> --url`, `codex mcp login`, ~/.codex/config.toml: https://developers.openai.com/codex/mcp
    // --bearer-token-env-var: https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs
    docs: "https://developers.openai.com/codex/mcp",
    detect: (io) => Boolean(which(io, "codex")),
  },
  {
    id: "vscode",
    name: "VS Code",
    aliases: ["code"],
    // .vscode/mcp.json with "servers" and "type": "http", and `code --add-mcp`:
    // https://code.visualstudio.com/docs/copilot/reference/mcp-configuration
    docs: "https://code.visualstudio.com/docs/copilot/reference/mcp-configuration",
    detect: (io) => Boolean(which(io, "code")),
  },
];

export function findClient(name) {
  return CLIENTS.find((c) => c.id === name || c.aliases.includes(name)) || null;
}

/** The entry that each client keeps for the Taskade server. */
export function expectedEntry(clientId, url, token) {
  const headers = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  switch (clientId) {
    case "claude-code":
    case "vscode":
      return { type: "http", url, ...headers };
    case "cursor":
      return { url, ...headers };
    case "codex":
      return token ? { url, bearer_token_env_var: "TASKADE_TOKEN" } : { url };
    default:
      return null;
  }
}

export function claudeUserFile(io) {
  return join(homeDir(io), ".claude.json");
}

export function codexConfigFile(io) {
  return join(getEnv(io.env, "CODEX_HOME") || join(homeDir(io), ".codex"), "config.toml");
}

/**
 * Read the [mcp_servers.taskade] table of a Codex config.toml.
 * Reads only the plain `key = "value"` lines that this CLI compares.
 */
export function readCodexEntry(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*\[\s*mcp_servers\.(taskade|"taskade")\s*\]\s*(#.*)?$/.test(l));
  if (start === -1) return null;
  const entry = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break;
    const m = /^\s*([A-Za-z_]+)\s*=\s*"([^"]*)"\s*(#.*)?$/.exec(line);
    if (m && (m[1] === "url" || m[1] === "bearer_token_env_var")) entry[m[1]] = m[2];
  }
  return entry;
}

function jsonEntry(file, key) {
  const config = readConfig(file, key);
  if (!config.exists) return { file, missing: true };
  if (config.error) return { file, error: config.error };
  return { file, entry: config.data[key]?.[SERVER_NAME] };
}

/**
 * Every place where a client can hold a Taskade server entry. Read only.
 * Returns a list of { file, entry, error, missing, label }.
 */
export function clientEntries(io, clientId) {
  const home = homeDir(io);
  switch (clientId) {
    case "claude-code": {
      const user = jsonEntry(claudeUserFile(io), "mcpServers");
      const found = [{ ...user, label: "user" }];
      const config = readConfig(claudeUserFile(io), "mcpServers");
      const local = config.data?.projects?.[io.cwd]?.mcpServers?.[SERVER_NAME];
      if (local) found.push({ file: claudeUserFile(io), entry: local, label: "local" });
      found.push({ ...jsonEntry(join(io.cwd, ".mcp.json"), "mcpServers"), label: "project" });
      return found;
    }
    case "cursor":
      return [
        { ...jsonEntry(join(home, ".cursor", "mcp.json"), "mcpServers"), label: "user" },
        { ...jsonEntry(join(io.cwd, ".cursor", "mcp.json"), "mcpServers"), label: "project" },
      ];
    case "codex": {
      const file = codexConfigFile(io);
      return [{ file, entry: readCodexEntry(file) || undefined, missing: !exists(file), label: "user" }];
    }
    case "vscode":
      return [{ ...jsonEntry(join(io.cwd, ".vscode", "mcp.json"), "servers"), label: "project" }];
    default:
      return [];
  }
}
