// `taskade doctor`: answer "why does my connection fail?" in plain lines.
// It changes nothing on the machine. It sends TASKADE_TOKEN only to the
// server URL, and it never follows a redirect with the token.
//
// Sign-in discovery follows the MCP authorization spec:
// https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
// The token check follows the Streamable HTTP transport:
// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http

import { CLIENTS, RUN, TOKEN_PAGE, clientEntries, serverUrl } from "./clients.mjs";
import { getEnv, tildify } from "./system.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 15000;

export async function doctor(io, opts) {
  const checks = [];
  const add = (group, status, message, next) => checks.push({ group, status, message, ...(next ? { next } : {}) });
  let tools;

  let url;
  try {
    url = serverUrl(io);
  } catch (err) {
    add("server", "fail", err.message, "Unset TASKADE_MCP_URL, or set it to an https:// URL.");
  }

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 18) add("machine", "ok", `Node.js ${process.version}. This CLI needs Node.js 18 or later.`);
  else add("machine", "fail", `Node.js ${process.version} is too old.`, "Install Node.js 18 or later.");

  if (url) {
    await checkServer(url, add, io);
    const token = (getEnv(io.env, "TASKADE_TOKEN") || "").trim();
    if (!token) {
      add("token", "skip", "TASKADE_TOKEN is not set, so the token check is skipped. Clients that sign in need no token.");
    } else {
      tools = await checkToken(url, token, add, io.version);
    }
  }

  for (const client of CLIENTS) checkClient(io, client, add);

  const ok = checks.every((c) => c.status !== "fail");
  if (opts.json) {
    const result = { ok, server: url || null, checks };
    if (opts.verbose && tools) result.tools = tools;
    io.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return ok ? 0 : 1;
  }

  const out = (text = "") => io.stdout.write(text + "\n");
  const mark = { ok: "ok  ", fail: "fail", skip: "--  " };
  out(`Taskade doctor${url ? ` (server: ${url})` : ""}`);
  let group = null;
  for (const c of checks) {
    if (c.group !== group) {
      out();
      if (c.group === "clients") out("Clients (read only):");
      group = c.group;
    }
    out(`${mark[c.status]}  ${c.message}`);
    if (c.next) out(`      Next: ${c.next}`);
    if (c.group === "token" && c.status === "ok" && opts.verbose && tools) {
      for (const name of tools) out(`      - ${name}`);
    }
  }
  out();
  out(ok ? "Every check passed." : "A check failed. See the Next line under it.");
  return ok ? 0 : 1;
}

function describeError(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `no answer in ${TIMEOUT_MS / 1000} seconds`;
  const cause = err?.cause?.code || err?.cause?.message;
  return cause ? `${err.message} (${cause})` : String(err?.message || err);
}

async function readError(res) {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text);
    const message = body.error?.message || body.error_description || body.message || body.error;
    if (typeof message === "string") return message;
  } catch {
    // Not JSON: show the text.
  }
  return text.trim().slice(0, 200) || res.statusText || "no message";
}

async function getJson(target) {
  const res = await fetch(target, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${target} answered ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${target} did not return JSON`);
  }
}

function initializeBody(version) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "taskade-cli", version: version || "0.0.0" },
    },
  };
}

async function checkServer(url, add, io) {
  const next = "Check your network, proxy, or firewall, then run doctor again.";
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(initializeBody(io.version)),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    add("server", "fail", `Cannot reach ${url}: ${describeError(err)}.`, next);
    return;
  }
  await res.body?.cancel().catch(() => {});
  const header = res.headers.get("www-authenticate") || "";
  const match = /resource_metadata="([^"]+)"/i.exec(header);
  if (res.status !== 401 || !match) {
    add(
      "server",
      "fail",
      `Without sign-in the server must answer 401 and name its sign-in metadata. It answered ${res.status}${match ? "" : " with no resource_metadata"}.`,
      "Check the server URL. The hosted server is https://www.taskade.com/mcp.",
    );
    return;
  }
  add("server", "ok", "The server answers. Without sign-in it returns 401 and names its sign-in metadata.");

  let resource;
  try {
    resource = await getJson(match[1]);
  } catch (err) {
    add("server", "fail", `Cannot read the sign-in metadata: ${describeError(err)}.`, next);
    return;
  }
  const servers = resource.authorization_servers;
  if (typeof resource.resource !== "string" || !Array.isArray(servers) || typeof servers[0] !== "string") {
    add("server", "fail", `The sign-in metadata at ${match[1]} lacks "resource" or "authorization_servers".`);
    return;
  }
  if (resource.resource.replace(/\/$/, "") !== url.replace(/\/$/, "")) {
    add(
      "server",
      "fail",
      `The sign-in metadata names ${resource.resource}, not ${url}. Clients refuse to sign in for it.`,
      "Use the URL that the metadata names.",
    );
    return;
  }
  add("server", "ok", `Sign-in metadata: ${match[1]}`);

  const issuer = new URL(servers[0]);
  const suffix = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  const candidates = [
    `${issuer.origin}/.well-known/oauth-authorization-server${suffix}`,
    `${issuer.origin}/.well-known/openid-configuration${suffix}`,
  ];
  let meta;
  let metaUrl;
  for (const candidate of candidates) {
    try {
      meta = await getJson(candidate);
      metaUrl = candidate;
      break;
    } catch {
      // Try the next well-known path.
    }
  }
  if (!meta) {
    add("server", "fail", `Cannot read the authorization server metadata of ${servers[0]}.`, next);
    return;
  }
  const missing = ["issuer", "authorization_endpoint", "token_endpoint"].filter((k) => typeof meta[k] !== "string");
  if (!(meta.code_challenge_methods_supported || []).includes("S256")) missing.push("code_challenge_methods_supported with S256");
  if (!meta.registration_endpoint && meta.client_id_metadata_document_supported !== true) missing.push("registration_endpoint");
  if (missing.length) {
    add("server", "fail", `The authorization server metadata at ${metaUrl} lacks: ${missing.join(", ")}.`);
    return;
  }
  add("server", "ok", `Authorization server: ${metaUrl}`);
}

/** Read the JSON-RPC answer with `id` from a JSON body or an event stream. */
async function readAnswer(res, id) {
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/event-stream")) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n?/g, "\n");
      if (done) buffer += "\n\n";
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        let message;
        try {
          message = JSON.parse(data);
        } catch {
          continue;
        }
        const found = [].concat(message).find((m) => m && m.id === id);
        if (found) {
          reader.cancel().catch(() => {});
          return found;
        }
      }
      if (done) throw new Error("the event stream ended with no answer");
    }
  }
  const body = await res.json();
  const found = [].concat(body).find((m) => m && m.id === id);
  if (!found) throw new Error("the answer holds no JSON-RPC response");
  return found;
}

async function checkToken(url, token, add, version) {
  let sessionId = null;
  let protocol = null;
  const post = (body) => {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    if (protocol) headers["MCP-Protocol-Version"] = protocol;
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };

  // Send one request and return its JSON-RPC answer, or null after a failed check.
  const call = async (body, step) => {
    let res;
    try {
      res = await post(body);
    } catch (err) {
      add("token", "fail", `Cannot reach the server for ${step}: ${describeError(err)}.`);
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      add("token", "fail", `The server answered ${step} with a redirect (${res.status}). The CLI does not send the token on.`);
      return null;
    }
    if (res.status === 401) {
      add(
        "token",
        "fail",
        `The server refused the token (401: ${await readError(res)}).`,
        `Create a new token at ${TOKEN_PAGE} and set TASKADE_TOKEN to it.`,
      );
      return null;
    }
    if (res.status === 403) {
      add(
        "token",
        "fail",
        `The server accepted the token but refused access (403: ${await readError(res)}).`,
        "Use a workspace on a paid Taskade plan. Every paid plan includes the hosted MCP server.",
      );
      return null;
    }
    if (!res.ok) {
      add("token", "fail", `The server answered ${step} with ${res.status}: ${await readError(res)}.`);
      return null;
    }
    if (body.id === undefined) {
      await res.body?.cancel().catch(() => {});
      return {};
    }
    if (!sessionId) sessionId = res.headers.get("mcp-session-id");
    let answer;
    try {
      answer = await readAnswer(res, body.id);
    } catch (err) {
      add("token", "fail", `Cannot read the answer to ${step}: ${describeError(err)}.`);
      return null;
    }
    if (answer.error) {
      add("token", "fail", `The server refused ${step}: ${answer.error.message} (code ${answer.error.code}).`);
      return null;
    }
    return answer;
  };

  const init = await call(initializeBody(version), "initialize");
  if (!init) return undefined;
  protocol = init.result?.protocolVersion || PROTOCOL_VERSION;
  if (!(await call({ jsonrpc: "2.0", method: "notifications/initialized" }, "notifications/initialized"))) return undefined;
  const list = await call({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, "tools/list");
  if (sessionId) {
    // End the session. The answer does not matter.
    await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Mcp-Session-Id": sessionId, "MCP-Protocol-Version": protocol },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
      .then((r) => r.body?.cancel())
      .catch(() => {});
  }
  if (!list) return undefined;
  const names = (list.result?.tools || []).map((t) => t?.name).filter((n) => typeof n === "string");
  if (names.length === 0) {
    add("token", "fail", "The token works, but the server lists no tools.", "Use a workspace on a paid Taskade plan.");
    return undefined;
  }
  add("token", "ok", "The token works and the server lists its tools.");
  return names;
}

function checkClient(io, client, add) {
  if (!client.detect(io)) {
    add("clients", "skip", `${client.name}: not found on this machine.`);
    return;
  }
  if (client.id === "claude-desktop") {
    add(
      "clients",
      "skip",
      `${client.name}: installed. Claude keeps connectors in your Claude account, so the CLI cannot read them.`,
      "In Claude Desktop, open Customize, then Connectors, and look for Taskade.",
    );
    return;
  }
  const places = clientEntries(io, client.id);
  const found = places.filter((p) => p.entry);
  const broken = places.filter((p) => p.error);
  for (const p of broken) {
    add("clients", "fail", `${client.name}: ${tildify(io, p.file)}: ${p.error}.`, "Fix the file. The client cannot read it either.");
  }
  if (found.length) {
    for (const p of found) {
      const usesToken = Boolean(p.entry.headers?.Authorization || p.entry.bearer_token_env_var);
      const target = p.entry.url || p.entry.serverUrl || "no url";
      add(
        "clients",
        "ok",
        `${client.name}: taskade server in ${tildify(io, p.file)} (${p.label}${usesToken ? ", token" : ", sign-in"}) points at ${target}.`,
      );
    }
    return;
  }
  const where = client.id === "vscode" ? " in .vscode/mcp.json of this folder. The CLI cannot read the user profile" : "";
  add("clients", "skip", `${client.name}: installed, no taskade server found${where}.`, `${RUN} plug ${client.id}`);
}
