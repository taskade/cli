import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { calls, fakeCommand, runCli, runInTerminal, sandbox } from "./helpers.mjs";

const SERVER = "https://www.taskade.com/mcp";
const TOKEN = "tskdp_secret_value_0123456789";
const POSIX = process.platform !== "win32";

function cursorFile(box) {
  return join(box.home, ".cursor", "mcp.json");
}

function writeJson(file, value, text) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text ?? JSON.stringify(value, null, 2) + "\n");
}

function backups(file) {
  const dir = join(file, "..");
  const base = file.split(/[\\/]/).pop();
  return readdirSync(dir).filter((f) => f.startsWith(`${base}.bak-`));
}

function noTokenIn(r) {
  assert.ok(!r.stdout.includes(TOKEN), "stdout must not hold the full token");
  assert.ok(!r.stderr.includes(TOKEN), "stderr must not hold the full token");
}

// --print for each client

test("plug claude-code --print shows the command and runs nothing", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "claude");
  const r = await runCli(box, ["plug", "claude-code", "--print"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /claude mcp add --transport http --scope user taskade https:\/\/www\.taskade\.com\/mcp/);
  assert.match(r.stdout, /Nothing changed/);
  assert.deepEqual(calls(box, "claude"), []);
});

test("plug claude is an alias of claude-code", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "claude", "--print"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /claude mcp add --transport http --scope user taskade/);
});

test("plug codex --print shows both commands", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "codex", "--print"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /codex mcp add taskade --url https:\/\/www\.taskade\.com\/mcp/);
  assert.match(r.stdout, /codex mcp login taskade/);
});

test("plug cursor --print shows the block and writes nothing", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "cursor", "--print"]);
  assert.equal(r.code, 0);
  const block = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"), r.stdout.lastIndexOf("}") + 1));
  assert.deepEqual(block, { mcpServers: { taskade: { url: SERVER } } });
  assert.throws(() => statSync(cursorFile(box)));
});

test("plug vscode --print shows the code --add-mcp command", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "vscode", "--print"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /code --add-mcp '\{"name":"taskade","type":"http","url":"https:\/\/www\.taskade\.com\/mcp"\}'/);
});

test("plug vscode --project --print shows the .vscode/mcp.json block with servers", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "vscode", "--project", "--print"]);
  assert.equal(r.code, 0);
  const block = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"), r.stdout.lastIndexOf("}") + 1));
  assert.deepEqual(block, { servers: { taskade: { type: "http", url: SERVER } } });
});

test("plug claude-desktop --print gives the 3 steps and copies nothing", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "claude-desktop", "--print"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /1\. .*Connectors/);
  assert.match(r.stdout, /2\. .*Add custom connector.*https:\/\/www\.taskade\.com\/mcp/);
  assert.match(r.stdout, /3\. .*sign in/);
  assert.match(r.stdout, /cannot add one for you/);
  assert.doesNotMatch(r.stdout, /Copied/);
});

test("on a pipe with no flag, plug only prints", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "claude");
  const a = await runCli(box, ["plug", "claude-code"]);
  const b = await runCli(box, ["plug", "cursor"]);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.match(b.stdout, /--yes/);
  assert.deepEqual(calls(box, "claude"), []);
  assert.throws(() => statSync(cursorFile(box)));
});

// plug with no client

test("plug with no client lists the clients on the machine and changes nothing", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "claude");
  mkdirSync(join(box.home, ".cursor"));
  const r = await runCli(box, ["plug"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Claude Code\s+npx @taskade\/cli plug claude-code/);
  assert.match(r.stdout, /Cursor\s+npx @taskade\/cli plug cursor/);
  assert.match(r.stdout, /Not found: .*Codex/);
  assert.deepEqual(calls(box, "claude"), []);
  assert.deepEqual(readdirSync(join(box.home, ".cursor")), []);
});

test("connect is an alias of plug", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["connect"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /No supported MCP client found/);
});

// JSON merge

test("cursor: --yes creates a new file", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "cursor", "--yes"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(cursorFile(box), "utf8")), { mcpServers: { taskade: { url: SERVER } } });
  assert.deepEqual(backups(cursorFile(box)), []);
  assert.match(r.stdout, /Wrote ~[\\/]\.cursor[\\/]mcp\.json/);
});

test("cursor: --yes keeps other servers and other keys, and writes a backup", async (t) => {
  const box = sandbox(t);
  const before = { theme: "dark", mcpServers: { github: { url: "https://example.com/mcp" }, local: { command: "x" } } };
  const original = JSON.stringify(before, null, 4) + "\n";
  writeJson(cursorFile(box), null, original);
  const r = await runCli(box, ["plug", "cursor", "--yes"]);
  assert.equal(r.code, 0, r.stderr);
  const text = readFileSync(cursorFile(box), "utf8");
  assert.deepEqual(JSON.parse(text), {
    theme: "dark",
    mcpServers: { github: { url: "https://example.com/mcp" }, local: { command: "x" }, taskade: { url: SERVER } },
  });
  assert.match(text, /^ {4}"theme"/m, "keeps the indent of the file");
  const [backup] = backups(cursorFile(box));
  assert.ok(backup, "a backup is written");
  assert.equal(readFileSync(join(box.home, ".cursor", backup), "utf8"), original);
  assert.match(r.stdout, /\+\s+"taskade"/);
});

test("cursor: the merge changes only the lines of the taskade entry", async (t) => {
  const box = sandbox(t);
  const cases = [
    [
      '{\n    "mcpServers": {\n        "github": { "url": "https://example.com/mcp" }\n    }\n}\n',
      '{\n    "mcpServers": {\n        "github": { "url": "https://example.com/mcp" },\n        "taskade": {\n            "url": "https://www.taskade.com/mcp"\n        }\n    }\n}\n',
    ],
    [
      '{\n  "theme": "dark"\n}\n',
      '{\n  "theme": "dark",\n  "mcpServers": {\n    "taskade": {\n      "url": "https://www.taskade.com/mcp"\n    }\n  }\n}\n',
    ],
    [
      '{\n  "mcpServers": {\n    "taskade": { "url": "https://old.example.com" },\n    "x": { "url": "https://x.example.com" }\n  }\n}',
      '{\n  "mcpServers": {\n    "taskade": {\n      "url": "https://www.taskade.com/mcp"\n    },\n    "x": { "url": "https://x.example.com" }\n  }\n}',
    ],
    ['{"mcpServers":{}}', '{"mcpServers":{\n  "taskade": {\n    "url": "https://www.taskade.com/mcp"\n  }\n}}'],
    [
      '{\r\n  "mcpServers": {\r\n    "a": { "url": "https://a.example.com" }\r\n  }\r\n}\r\n',
      '{\r\n  "mcpServers": {\r\n    "a": { "url": "https://a.example.com" },\r\n    "taskade": {\r\n      "url": "https://www.taskade.com/mcp"\r\n    }\r\n  }\r\n}\r\n',
    ],
  ];
  for (const [before, after] of cases) {
    writeJson(cursorFile(box), null, before);
    const r = await runCli(box, ["plug", "cursor", "--yes"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(readFileSync(cursorFile(box), "utf8"), after);
  }
});

test("cursor: an equal entry says already connected and changes nothing", async (t) => {
  const box = sandbox(t);
  const text = JSON.stringify({ mcpServers: { taskade: { url: SERVER } } });
  writeJson(cursorFile(box), null, text);
  const r = await runCli(box, ["plug", "cursor", "--yes"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Already connected/);
  assert.equal(readFileSync(cursorFile(box), "utf8"), text);
  assert.deepEqual(backups(cursorFile(box)), []);
});

test("cursor: a different entry is shown and replaced only after a yes", async (t) => {
  const box = sandbox(t);
  const old = { mcpServers: { taskade: { url: "https://old.example.com/mcp" } } };
  writeJson(cursorFile(box), old);

  const no = await runInTerminal(box, ["plug", "cursor"], { answer: false });
  assert.equal(no.code, 0);
  assert.equal(no.questions.length, 1);
  assert.match(no.stdout, /-\s+"url": "https:\/\/old\.example\.com\/mcp"/);
  assert.match(no.stdout, /\+\s+"url": "https:\/\/www\.taskade\.com\/mcp"/);
  assert.deepEqual(JSON.parse(readFileSync(cursorFile(box), "utf8")), old);

  const yes = await runInTerminal(box, ["plug", "cursor"], { answer: true });
  assert.equal(yes.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(cursorFile(box), "utf8")), { mcpServers: { taskade: { url: SERVER } } });
  assert.equal(backups(cursorFile(box)).length, 1);
});

test("cursor: invalid JSON is refused and left unchanged", async (t) => {
  const box = sandbox(t);
  const text = '{ "mcpServers": { // a comment\n } }\n';
  writeJson(cursorFile(box), null, text);
  const r = await runCli(box, ["plug", "cursor", "--yes"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not valid JSON/);
  assert.match(r.stderr, /Nothing changed/);
  assert.equal(readFileSync(cursorFile(box), "utf8"), text);
  assert.deepEqual(backups(cursorFile(box)), []);
});

test("cursor: a non-object mcpServers is refused", async (t) => {
  const box = sandbox(t);
  writeJson(cursorFile(box), { mcpServers: [] });
  const r = await runCli(box, ["plug", "cursor", "--yes"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /"mcpServers" in the file is not a JSON object/);
});

test("cursor: the file mode is kept", { skip: !POSIX }, async (t) => {
  const box = sandbox(t);
  writeJson(cursorFile(box), { mcpServers: {} });
  chmodSync(cursorFile(box), 0o640);
  const r = await runCli(box, ["plug", "cursor", "--yes"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(statSync(cursorFile(box)).mode & 0o777, 0o640);
  const [backup] = backups(cursorFile(box));
  assert.equal(statSync(join(box.home, ".cursor", backup)).mode & 0o777, 0o640);
});

test("cursor --project writes .cursor/mcp.json in the current folder", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "cursor", "--project", "--yes"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(box.cwd, ".cursor", "mcp.json"), "utf8")), {
    mcpServers: { taskade: { url: SERVER } },
  });
  assert.throws(() => statSync(cursorFile(box)));
});

test("vscode --project --yes writes .vscode/mcp.json with the servers key", async (t) => {
  const box = sandbox(t);
  writeJson(join(box.cwd, ".vscode", "mcp.json"), { servers: { other: { type: "stdio", command: "x" } }, inputs: [] });
  const r = await runCli(box, ["plug", "vscode", "--project", "--yes"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(box.cwd, ".vscode", "mcp.json"), "utf8")), {
    servers: { other: { type: "stdio", command: "x" }, taskade: { type: "http", url: SERVER } },
    inputs: [],
  });
});

// --token

test("--token writes the token to the file but never prints it", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "cursor", "--token", "--yes"], { TASKADE_TOKEN: TOKEN });
  assert.equal(r.code, 0, r.stderr);
  noTokenIn(r);
  assert.match(r.stdout, /tskdp_…/);
  assert.match(r.stdout, /Warning: .* will hold your token/);
  const data = JSON.parse(readFileSync(cursorFile(box), "utf8"));
  assert.deepEqual(data.mcpServers.taskade, { url: SERVER, headers: { Authorization: `Bearer ${TOKEN}` } });
  if (POSIX) assert.equal(statSync(cursorFile(box)).mode & 0o777, 0o600);
});

test("--token --print masks the token in the block", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "cursor", "--token", "--print", "--project"], { TASKADE_TOKEN: TOKEN });
  assert.equal(r.code, 0);
  noTokenIn(r);
  assert.match(r.stdout, /"Authorization": "Bearer tskdp_…"/);
  assert.match(r.stdout, /Do not commit/);
});

test("--token with no TASKADE_TOKEN exits 1", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "cursor", "--token", "--yes"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /TASKADE_TOKEN is not set/);
});

test("a token passed as an argument is refused and never echoed", async (t) => {
  const box = sandbox(t);
  for (const args of [
    ["plug", "cursor", `--token=${TOKEN}`],
    ["plug", "cursor", TOKEN],
    ["plug", "--token", TOKEN],
    ["plug", "--token", "abc123notaclient"],
    ["plug", "cursor", "--token", "abc123notaclient"],
    ["doctor", TOKEN],
  ]) {
    const r = await runCli(box, args);
    assert.equal(r.code, 1, args.join(" "));
    assert.match(r.stderr, /Never pass a token on the command line/, args.join(" "));
    assert.ok(!r.stderr.includes(TOKEN) && !r.stderr.includes("abc123notaclient"), args.join(" "));
    assert.ok(!r.stdout.includes(TOKEN), args.join(" "));
  }
  assert.throws(() => statSync(cursorFile(box)));
});

test("claude-desktop refuses --token", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "claude-desktop", "--token"], { TASKADE_TOKEN: TOKEN });
  assert.equal(r.code, 1);
  noTokenIn(r);
});

// Command clients, with fake commands on a temporary PATH

test("claude-code --yes runs claude mcp add with user scope", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "claude");
  const r = await runCli(box, ["plug", "claude-code", "--yes"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(
    calls(box, "claude").map((c) => c.args),
    [["mcp", "add", "--transport", "http", "--scope", "user", "taskade", SERVER]],
  );
  assert.match(r.stdout, /type \/mcp/);
});

test("claude-code --project uses the project scope", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "claude");
  const r = await runCli(box, ["plug", "claude-code", "--project", "--yes"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(calls(box, "claude")[0].args.slice(4, 6), ["--scope", "project"]);
});

test("claude-code asks in a terminal, and a no runs nothing", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "claude");
  const r = await runInTerminal(box, ["plug", "claude-code"], { answer: false });
  assert.equal(r.code, 0);
  assert.deepEqual(r.questions, ["Run this command? [y/N] "]);
  assert.deepEqual(calls(box, "claude"), []);
});

test("claude-code with an equal entry in ~/.claude.json runs nothing", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "claude");
  writeJson(join(box.home, ".claude.json"), { mcpServers: { taskade: { type: "http", url: SERVER } } });
  const r = await runCli(box, ["plug", "claude-code", "--yes"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Already connected/);
  assert.deepEqual(calls(box, "claude"), []);
});

test("claude-code with a different entry removes it, then adds", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "claude");
  writeJson(join(box.home, ".claude.json"), {
    mcpServers: { taskade: { type: "http", url: SERVER, headers: { Authorization: `Bearer ${TOKEN}` } } },
  });
  const r = await runCli(box, ["plug", "claude-code", "--yes"]);
  assert.equal(r.code, 0, r.stderr);
  noTokenIn(r);
  assert.match(r.stdout, /Current entry/);
  assert.deepEqual(
    calls(box, "claude").map((c) => c.args.slice(0, 2)),
    [
      ["mcp", "remove"],
      ["mcp", "add"],
    ],
  );
});

test("claude-code --token passes the header to claude and masks it on screen", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "claude");
  const r = await runCli(box, ["plug", "claude-code", "--token", "--yes"], { TASKADE_TOKEN: TOKEN });
  assert.equal(r.code, 0, r.stderr);
  noTokenIn(r);
  assert.deepEqual(calls(box, "claude")[0].args.slice(-2), ["--header", `Authorization: Bearer ${TOKEN}`]);
});

test("claude-code not on PATH prints the command and the install step, exit 0", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "claude-code", "--yes"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /not on your PATH/);
  assert.match(r.stdout, /code\.claude\.com\/docs\/en\/setup/);
});

test("a failed client command exits 1", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "claude");
  const r = await runCli(box, ["plug", "claude-code", "--yes"], { FAKE_CLAUDE_EXIT: "3" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /claude mcp add failed \(exit code 3\)/);
});

test("codex --yes runs mcp add, then mcp login", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "codex");
  const r = await runCli(box, ["plug", "codex", "--yes"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(
    calls(box, "codex").map((c) => c.args),
    [
      ["mcp", "add", "taskade", "--url", SERVER],
      ["mcp", "login", "taskade"],
    ],
  );
});

test("codex: no second sign-in when mcp add already signed in", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "codex");
  const r = await runCli(box, ["plug", "codex", "--yes"], { FAKE_CODEX_STDOUT: "Successfully logged in." });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(calls(box, "codex").length, 1);
});

test("codex --token uses --bearer-token-env-var and no sign-in", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "codex");
  const r = await runCli(box, ["plug", "codex", "--token", "--yes"], { TASKADE_TOKEN: TOKEN });
  assert.equal(r.code, 0, r.stderr);
  noTokenIn(r);
  assert.deepEqual(
    calls(box, "codex").map((c) => c.args),
    [["mcp", "add", "taskade", "--url", SERVER, "--bearer-token-env-var", "TASKADE_TOKEN"]],
  );
});

test("codex with an equal entry in config.toml runs nothing", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "codex");
  mkdirSync(join(box.home, ".codex"));
  writeFileSync(join(box.home, ".codex", "config.toml"), `model = "x"\n\n[mcp_servers.taskade]\nurl = "${SERVER}"\n`);
  const r = await runCli(box, ["plug", "codex", "--yes"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Already connected/);
  assert.deepEqual(calls(box, "codex"), []);
});

test("codex --project exits 1", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["plug", "codex", "--project", "--yes"]);
  assert.equal(r.code, 1);
});

test("vscode --yes runs code --add-mcp with the JSON entry", async (t) => {
  const box = sandbox(t);
  fakeCommand(box, "code");
  const r = await runCli(box, ["plug", "vscode", "--yes"]);
  assert.equal(r.code, 0, r.stderr);
  const [call] = calls(box, "code");
  assert.equal(call.args[0], "--add-mcp");
  assert.deepEqual(JSON.parse(call.args[1]), { name: "taskade", type: "http", url: SERVER });
});

test("claude-desktop copies the URL when a clipboard command exists", async (t) => {
  const box = sandbox(t);
  const tool = { darwin: "pbcopy", win32: "clip" }[process.platform] || "xclip";
  fakeCommand(box, tool);
  const key = tool.toUpperCase();
  const r = await runInTerminal(box, ["plug", "claude-desktop"], { extraEnv: { [`FAKE_${key}_STDIN`]: "1" } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Copied .* to the clipboard \\(${tool}\\)`));
  assert.equal(calls(box, tool)[0].input, SERVER);
});

test("claude-desktop says so when no clipboard command exists", async (t) => {
  const box = sandbox(t);
  const r = await runInTerminal(box, ["plug", "claude-desktop"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /No clipboard command found/);
});
