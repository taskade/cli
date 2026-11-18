import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runCli, sandbox } from "./helpers.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("help prints the commands, the clients, and the setup prompt", async (t) => {
  const box = sandbox(t);
  for (const args of [["help"], ["--help"], ["-h"], []]) {
    const r = await runCli(box, args);
    assert.equal(r.code, 0, args.join(" "));
    for (const word of ["plug", "doctor", "connect", "whoami", "claude-desktop", "--token", "SKILL.md"]) {
      assert.match(r.stdout, new RegExp(word.replace(/[.-]/g, "\\$&")), `${args.join(" ")}: ${word}`);
    }
  }
});

test("--version and -v print the package version", async (t) => {
  const box = sandbox(t);
  for (const flag of ["--version", "-v"]) {
    const r = await runCli(box, [flag]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), pkg.version);
  }
});

test("an unknown command prints a short message and exits 1", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["nonexistent"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Unknown command: nonexistent/);
  assert.ok(r.stderr.split("\n").length <= 3, "the message is short");
});

test("an unknown option exits 1", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "cursor", "--force"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Unknown option: --force/);
});

test("an option of another command exits 1", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["doctor", "--yes"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--yes does not apply to doctor/);
});

test("--print and --yes together exit 1", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "cursor", "--print", "--yes"]);
  assert.equal(r.code, 1);
});

test("an unknown client exits 1 and lists the known clients", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "notepad"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Unknown client: notepad/);
  assert.match(r.stderr, /claude-code, claude-desktop, cursor, codex, vscode/);
});

test("TASKADE_MCP_URL must be https, except for localhost", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "cursor", "--print"], { TASKADE_MCP_URL: "http://example.com/mcp" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /must use https:\/\//);
});
