import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { downUrl, fakeMcpServer, runCli, sandbox } from "./helpers.mjs";

const GOOD = "tskdp_good_token_123";
const BAD = "tskdp_fake_token_000000";

test("doctor with no token: the server answers 401 with sign-in metadata", async (t) => {
  const box = sandbox(t);
  const server = await fakeMcpServer(t);
  const r = await runCli(box, ["doctor"], { TASKADE_MCP_URL: server.url });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok\s+Node\.js/m);
  assert.match(r.stdout, /^ok\s+The server answers/m);
  assert.match(r.stdout, /^ok\s+Sign-in metadata: http:\/\/127\.0\.0\.1:\d+\/mcp\/\.well-known\/oauth-protected-resource/m);
  assert.match(r.stdout, /^ok\s+Authorization server: .*\/\.well-known\/oauth-authorization-server/m);
  assert.match(r.stdout, /^--\s+TASKADE_TOKEN is not set/m);
  assert.match(r.stdout, /Every check passed/);
  assert.ok(server.requests.every((q) => !q.headers.authorization), "no request carries a token");
});

test("whoami is an alias of doctor", async (t) => {
  const box = sandbox(t);
  const server = await fakeMcpServer(t);
  const r = await runCli(box, ["whoami"], { TASKADE_MCP_URL: server.url });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Taskade doctor/);
});

test("doctor with a bad token reports the refusal and exits 1", async (t) => {
  const box = sandbox(t);
  const server = await fakeMcpServer(t);
  const r = await runCli(box, ["doctor"], { TASKADE_MCP_URL: server.url, TASKADE_TOKEN: BAD });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^fail\s+The server refused the token \(401: Invalid or expired token\)/m);
  assert.match(r.stdout, /Next: Create a new token at https:\/\/www\.taskade\.com\/settings\/api/);
  assert.ok(!r.stdout.includes(BAD) && !r.stderr.includes(BAD));
});

for (const mode of ["json", "sse"]) {
  test(`doctor with a working token, ${mode} answers: initialize and tools/list`, async (t) => {
    const box = sandbox(t);
    const server = await fakeMcpServer(t, mode);
    const r = await runCli(box, ["doctor"], { TASKADE_MCP_URL: server.url, TASKADE_TOKEN: GOOD });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^ok\s+The token works and the server lists its tools\./m);
    assert.doesNotMatch(r.stdout, /list_spaces/, "tool names only with --verbose");
    assert.ok(!r.stdout.includes(GOOD));

    const posts = server.requests.filter((q) => q.method === "POST" && q.headers.authorization);
    assert.deepEqual(
      posts.map((q) => JSON.parse(q.body).method),
      ["initialize", "notifications/initialized", "tools/list"],
    );
    assert.equal(posts[2].headers["mcp-session-id"], "session-1");
    assert.equal(posts[2].headers["mcp-protocol-version"], "2025-06-18");
    assert.match(posts[0].headers.accept, /application\/json/);
    assert.match(posts[0].headers.accept, /text\/event-stream/);
    const withToken = server.requests.filter((q) => q.headers.authorization);
    assert.ok(withToken.every((q) => q.url === "/mcp"), "the token goes only to the server URL");
  });
}

test("doctor --verbose prints the tool names", async (t) => {
  const box = sandbox(t);
  const server = await fakeMcpServer(t);
  const r = await runCli(box, ["doctor", "--verbose"], { TASKADE_MCP_URL: server.url, TASKADE_TOKEN: GOOD });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /- list_spaces/);
  assert.match(r.stdout, /- create_task/);
});

test("doctor --json prints the result as JSON", async (t) => {
  const box = sandbox(t);
  const server = await fakeMcpServer(t);
  const r = await runCli(box, ["doctor", "--json"], { TASKADE_MCP_URL: server.url, TASKADE_TOKEN: GOOD });
  assert.equal(r.code, 0);
  const result = JSON.parse(r.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.server, server.url);
  assert.ok(result.checks.some((c) => c.group === "token" && c.status === "ok"));
  assert.equal(result.tools, undefined);

  const bad = await runCli(box, ["doctor", "--json", "--verbose"], { TASKADE_MCP_URL: server.url, TASKADE_TOKEN: BAD });
  assert.equal(bad.code, 1);
  assert.equal(JSON.parse(bad.stdout).ok, false);
});

test("doctor reports a 403 with the plan step", async (t) => {
  const box = sandbox(t);
  const server = await fakeMcpServer(t, "forbidden");
  const r = await runCli(box, ["doctor"], { TASKADE_MCP_URL: server.url, TASKADE_TOKEN: GOOD });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /refused access \(403: MCP access is not available/);
  assert.match(r.stdout, /Next: Use a workspace on a paid Taskade plan/);
});

test("doctor reports a server that is down", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["doctor"], { TASKADE_MCP_URL: await downUrl() });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^fail\s+Cannot reach http:\/\/127\.0\.0\.1:\d+\/mcp/m);
});

test("doctor never sends the token on through a redirect", async (t) => {
  const box = sandbox(t);
  const seen = [];
  const other = createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.end();
  });
  await new Promise((resolve) => other.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => other.close(resolve)));
  const redirecting = createServer((req, res) => {
    if (!req.headers.authorization) {
      const base = `http://127.0.0.1:${redirecting.address().port}`;
      res.writeHead(401, { "www-authenticate": `Bearer resource_metadata="${base}/meta"` });
      return res.end();
    }
    res.writeHead(307, { location: `http://127.0.0.1:${other.address().port}/mcp` });
    res.end();
  });
  await new Promise((resolve) => redirecting.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => redirecting.close(resolve)));
  const r = await runCli(box, ["doctor"], {
    TASKADE_MCP_URL: `http://127.0.0.1:${redirecting.address().port}/mcp`,
    TASKADE_TOKEN: GOOD,
  });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /redirect \(307\)/);
  assert.ok(seen.every((h) => h === undefined), "the other host never gets the token");
});

test("doctor refuses an http URL that is not localhost and sends nothing", async (t) => {
  const box = sandbox(t);
  const r = await runCli(box, ["doctor"], { TASKADE_MCP_URL: "http://example.com/mcp", TASKADE_TOKEN: GOOD });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /must use https:\/\//);
  assert.doesNotMatch(r.stdout, /Cannot reach/);
});

test("doctor lists the clients and their taskade entries, read only", async (t) => {
  const box = sandbox(t);
  const server = await fakeMcpServer(t);
  mkdirSync(join(box.home, ".cursor"));
  writeFileSync(join(box.home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { taskade: { url: server.url } } }));
  mkdirSync(join(box.cwd, ".vscode"));
  writeFileSync(join(box.cwd, ".vscode", "mcp.json"), "{ not json");
  const r = await runCli(box, ["doctor"], { TASKADE_MCP_URL: server.url });
  assert.match(r.stdout, /^ok\s+Cursor: taskade server in ~[\\/]\.cursor[\\/]mcp\.json \(user, sign-in\)/m);
  assert.match(r.stdout, /^--\s+Codex: not found on this machine\./m);
  assert.equal(r.code, 0, "an invalid file of a client that is not installed is not checked");
});

test("doctor fails on an invalid config file of an installed client", async (t) => {
  const box = sandbox(t);
  const server = await fakeMcpServer(t);
  mkdirSync(join(box.home, ".cursor"));
  writeFileSync(join(box.home, ".cursor", "mcp.json"), "{ not json");
  const r = await runCli(box, ["doctor"], { TASKADE_MCP_URL: server.url });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^fail\s+Cursor: .*not valid JSON/m);
});
