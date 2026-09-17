import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "bin", "cli.mjs");

function runCli(args, env = {}, input = "") {
  try {
    const output = execFileSync("node", [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      timeout: 5000,
      input,
    });
    return { stdout: output, stderr: "", exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status || 1,
    };
  }
}

test("help command prints usage", () => {
  const { stdout, exitCode } = runCli(["help"]);
  assert.equal(exitCode, 0);
  assert.match(stdout, /@taskade\/cli/);
  assert.match(stdout, /USAGE/);
  assert.match(stdout, /plug/);
  assert.match(stdout, /whoami/);
});

test("no args prints help", () => {
  const { stdout, exitCode } = runCli([]);
  assert.equal(exitCode, 0);
  assert.match(stdout, /USAGE/);
});

test("--help flag prints help", () => {
  const { stdout, exitCode } = runCli(["--help"]);
  assert.equal(exitCode, 0);
  assert.match(stdout, /USAGE/);
});

test("unknown command exits 1", () => {
  const { exitCode } = runCli(["nonexistent"]);
  assert.equal(exitCode, 1);
});

test("plug with token outputs valid JSON", () => {
  const { stdout, exitCode } = runCli(["plug"], {
    TASKADE_TOKEN: "tskdp_test123",
  });
  assert.equal(exitCode, 0);
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.mcpServers);
  assert.ok(parsed.mcpServers.taskade);
  assert.equal(parsed.mcpServers.taskade.url, "https://taskade.com/mcp");
  assert.equal(parsed.mcpServers.taskade.headers.Authorization, "Bearer tskdp_test123");
});

test("plug cursor includes Cursor instructions", () => {
  const { stdout, exitCode } = runCli(["plug", "cursor"], {
    TASKADE_TOKEN: "tskdp_test123",
  });
  assert.equal(exitCode, 0);
  assert.match(stdout, /Cursor/);
  assert.match(stdout, /\.cursor\/mcp\.json/);
});

test("plug claude includes Claude instructions", () => {
  const { stdout, exitCode } = runCli(["plug", "claude"], {
    TASKADE_TOKEN: "tskdp_test123",
  });
  assert.equal(exitCode, 0);
  assert.match(stdout, /Claude/);
  assert.match(stdout, /claude_desktop_config\.json/);
});

test("plug without token exits 1", () => {
  const { exitCode } = runCli(["plug"], { TASKADE_TOKEN: "" });
  assert.equal(exitCode, 1);
});

test("whoami without token exits 1", () => {
  const { exitCode } = runCli(["whoami"], { TASKADE_TOKEN: "" });
  assert.equal(exitCode, 1);
});
