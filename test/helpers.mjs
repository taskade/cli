// Test helpers. Every test runs in a temporary folder with its own HOME,
// USERPROFILE, APPDATA, and PATH, so no test reads or writes a real client config.

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const CLI = join(here, "..", "bin", "cli.mjs");
const FAKE = join(here, "fixtures", "fake-client.mjs");
const IS_WINDOWS = process.platform === "win32";

const SCRUB = /^(path|home|userprofile|appdata|localappdata|xdg_config_home|codex_home|taskade_token|taskade_mcp_url|wayland_display|display)$/i;

/** A temporary folder with home/, work/ (the current folder) and bin/ (the only PATH entry). */
export function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "taskade-cli-test-"));
  const home = join(root, "home");
  const cwd = join(root, "work");
  const bin = join(root, "bin");
  const logs = join(root, "logs");
  for (const dir of [home, cwd, bin, logs]) mkdirSync(dir, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SCRUB.test(k)));
  Object.assign(env, {
    PATH: bin,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    FAKE_LOG_DIR: logs,
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, home, cwd, bin, logs, env };
}

/** Put a fake command on the PATH of the sandbox. */
export function fakeCommand(box, name) {
  if (IS_WINDOWS) {
    writeFileSync(join(box.bin, `${name}.cmd`), `@"${process.execPath}" "${FAKE}" ${name} %*\r\n`);
  } else {
    const file = join(box.bin, name);
    writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${name} "$@"\n`);
    chmodSync(file, 0o755);
  }
}

/** The calls that a fake command recorded. */
export function calls(box, name) {
  const file = join(box.logs, `${name}.log`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

/** Run the CLI as a child process. Its stdin is a pipe, so it is not interactive. */
export function runCli(box, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: box.cwd,
      env: { ...box.env, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.end();
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Run the CLI in this process as if in a terminal. `answer` is the reply to each question. */
export async function runInTerminal(box, args, { answer = false, extraEnv = {} } = {}) {
  let stdout = "";
  let stderr = "";
  const questions = [];
  const code = await main(args, {
    env: { ...box.env, ...extraEnv },
    cwd: box.cwd,
    platform: process.platform,
    interactive: true,
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    ask: async (q) => {
      questions.push(q);
      return answer;
    },
  });
  return { code, stdout, stderr, questions };
}

/**
 * A fake MCP server on 127.0.0.1. `mode` sets the answer for the good token:
 * "json", "sse", or "forbidden". The good token is "tskdp_good_token_123".
 * Every request is recorded in `requests`.
 */
export async function fakeMcpServer(t, mode = "json") {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    const base = `http://127.0.0.1:${server.address().port}`;
    const json = (status, value, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(value));
    };

    if (req.method === "GET" && req.url === "/mcp/.well-known/oauth-protected-resource") {
      return json(200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ["mcp"] });
    }
    if (req.method === "GET" && req.url === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: base,
        authorization_endpoint: `${base}/oauth2/authorize`,
        token_endpoint: `${base}/oauth2/token`,
        registration_endpoint: `${base}/oauth2/register`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (req.url !== "/mcp") return json(404, { error: "Not found" });

    const auth = req.headers.authorization;
    const challenge = { "www-authenticate": `Bearer realm="mcp", resource_metadata="${base}/mcp/.well-known/oauth-protected-resource"` };
    if (!auth) return json(401, { error: "Unauthorized" }, challenge);
    if (auth !== "Bearer tskdp_good_token_123") return json(401, { error: "Invalid or expired token" }, challenge);
    if (mode === "forbidden") return json(403, { error: "MCP access is not available on this workspace's current plan." });
    if (req.method === "DELETE") {
      res.writeHead(204);
      return res.end();
    }

    const message = JSON.parse(body);
    if (message.id === undefined) {
      res.writeHead(202);
      return res.end();
    }
    if (message.method !== "initialize" && req.headers["mcp-session-id"] !== "session-1") {
      return json(400, { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "No valid session" } });
    }
    const result =
      message.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } }
        : { tools: [{ name: "list_spaces" }, { name: "create_task" }] };
    const answer = { jsonrpc: "2.0", id: message.id, result };
    const headers = message.method === "initialize" ? { "mcp-session-id": "session-1" } : {};
    if (mode === "sse") {
      res.writeHead(200, { "content-type": "text/event-stream", ...headers });
      res.write(": comment\n\n");
      res.write(`event: message\ndata: ${JSON.stringify(answer)}\n\n`);
      return res.end();
    }
    return json(200, answer, headers);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, requests };
}

/** A URL on 127.0.0.1 where nothing listens. */
export async function downUrl() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}/mcp`;
}
