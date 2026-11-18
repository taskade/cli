// `taskade plug <client>`: connect one MCP client to the Taskade server.
// Sign-in (OAuth) is the default, and no token goes anywhere.
// `--token` puts a personal access token from TASKADE_TOKEN in a header.

import { join } from "node:path";
import {
  CLIENTS,
  RUN,
  SERVER_NAME,
  TOKEN_PAGE,
  claudeUserFile,
  codexConfigFile,
  expectedEntry,
  findClient,
  readCodexEntry,
  serverUrl,
} from "./clients.mjs";
import { deepEqual, lineDiff, mergedText, readConfig, writeConfig } from "./config-file.mjs";
import { copyToClipboard, getEnv, homeDir, mask, runCommand, tildify, which } from "./system.mjs";

/** Replace every Bearer value in a text with its first 6 characters. */
export function redact(text) {
  return String(text).replace(/(Bearer\s+)([^\s"'\\]+)/g, (_, prefix, secret) => prefix + mask(secret));
}

function show(value) {
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((line) => "  " + line)
    .join("\n");
}

function commandLine(file, args) {
  return [file, ...args].map((a) => (/^[\w\-.:/=@]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(" ");
}

export async function plug(io, opts) {
  const out = (text = "") => io.stdout.write(redact(text) + "\n");
  const fail = (text) => {
    io.stderr.write(redact(text) + "\n");
    return 1;
  };

  if (!opts.client) return listClients(io, out);

  const client = findClient(opts.client);
  if (!client) {
    return fail(`Unknown client: ${opts.client}\nKnown clients: ${CLIENTS.map((c) => c.id).join(", ")}`);
  }

  let url;
  try {
    url = serverUrl(io);
  } catch (err) {
    return fail(err.message);
  }

  let token = null;
  if (opts.token) {
    if (client.id === "claude-desktop") {
      return fail("Claude Desktop signs in through your browser. It takes no token from this CLI.");
    }
    token = (getEnv(io.env, "TASKADE_TOKEN") || "").trim();
    if (!token) return fail(`--token reads the token from TASKADE_TOKEN, and TASKADE_TOKEN is not set.\nCreate a token at ${TOKEN_PAGE}`);
    if (/\s/.test(token)) return fail("TASKADE_TOKEN holds a space or a line break. Set it to the token only.");
  }

  const mode = opts.print ? "print" : opts.yes ? "yes" : io.interactive ? "ask" : "print";
  const flags = [opts.project && "--project", opts.token && "--token"].filter(Boolean);
  const applyHint = `Nothing changed. To apply it, run: ${[RUN, "plug", client.id, ...flags, "--yes"].join(" ")}`;
  const ctx = { io, opts, out, fail, url, token, mode, applyHint, client };

  switch (client.id) {
    case "claude-code":
      return plugClaudeCode(ctx);
    case "codex":
      return plugCodex(ctx);
    case "cursor":
      return plugJsonFile(ctx, {
        file: join(opts.project ? io.cwd : homeDir(io), ".cursor", "mcp.json"),
        key: "mcpServers",
        next: token
          ? "Next: open Cursor Settings, then MCP. Cursor sends your token, so no sign-in is needed."
          : "Next: open Cursor Settings, then MCP. Find taskade and sign in when Cursor asks.",
      });
    case "vscode":
      if (opts.project) {
        return plugJsonFile(ctx, {
          file: join(io.cwd, ".vscode", "mcp.json"),
          key: "servers",
          next: token
            ? "Next: open .vscode/mcp.json in VS Code and click Start above taskade. VS Code sends your token."
            : "Next: open .vscode/mcp.json in VS Code, click Start above taskade, and sign in when VS Code asks.",
        });
      }
      return plugVsCodeUser(ctx);
    case "claude-desktop":
      return plugClaudeDesktop(ctx);
    default:
      return fail(`Unknown client: ${opts.client}`);
  }
}

function listClients(io, out) {
  const found = CLIENTS.filter((c) => c.detect(io));
  const missing = CLIENTS.filter((c) => !found.includes(c));
  if (found.length === 0) {
    out("No supported MCP client found on this machine.");
  } else {
    out("MCP clients on this machine:");
    const width = Math.max(...found.map((c) => c.name.length));
    for (const c of found) out(`  ${c.name.padEnd(width)}  ${RUN} plug ${c.id}`);
  }
  if (missing.length) out(`Not found: ${missing.map((c) => `${c.name} (${c.id})`).join(", ")}.`);
  out();
  out("Each command shows the change first and asks before it changes anything.");
  out("Nothing changed.");
  return 0;
}

function tokenWarning(ctx, file, isProject) {
  ctx.out(`Warning: ${file} will hold your token. Anyone who can read the file can use your Taskade account.`);
  if (isProject) ctx.out(`Do not commit ${file}. Add it to .gitignore.`);
}

async function confirm(ctx, question) {
  if (ctx.mode === "yes") return true;
  const ok = await ctx.io.ask(`${question} [y/N] `);
  if (!ok) ctx.out("Nothing changed.");
  return ok;
}

// Claude Code: its own command. The default scope is "user", so the server
// works in every project. --project uses the "project" scope (.mcp.json).
async function plugClaudeCode(ctx) {
  const { io, opts, out, fail, url, token } = ctx;
  const scope = opts.project ? "project" : "user";
  const args = ["mcp", "add", "--transport", "http", "--scope", scope, SERVER_NAME, url];
  if (token) args.push("--header", `Authorization: Bearer ${token}`);
  const file = opts.project ? join(io.cwd, ".mcp.json") : claudeUserFile(io);
  const config = readConfig(file, "mcpServers");
  const existing = config.data?.mcpServers?.[SERVER_NAME];
  const expected = expectedEntry("claude-code", url, token);

  out("Claude Code adds the server with its own command:");
  out(`  ${commandLine("claude", args)}`);
  out(
    opts.project
      ? "Claude Code writes the server to .mcp.json in this folder, to share with your team."
      : "Claude Code keeps the server in ~/.claude.json, for all of your projects.",
  );
  if (token) tokenWarning(ctx, tildify(io, file), opts.project);
  const signIn = token
    ? "Claude Code sends your token, so no sign-in is needed."
    : "Next: start Claude Code, type /mcp, select taskade, and sign in.";

  if (existing && deepEqual(existing, expected)) {
    out("Claude Code already has this taskade server. Already connected. Nothing changed.");
    if (!token) out(signIn.replace("Next: ", "To sign in again: "));
    return 0;
  }
  if (existing) {
    out(`Claude Code already has a different server named taskade in ${tildify(io, file)}.`);
    out("Current entry:");
    out(show(existing));
    out("New entry:");
    out(show(expected));
    out(`The CLI removes the current entry first: claude mcp remove --scope ${scope} taskade`);
  }

  const bin = which(io, "claude");
  if (!bin) {
    out("The claude command is not on your PATH.");
    out("Install Claude Code (https://code.claude.com/docs/en/setup), then run the command above.");
    return 0;
  }
  if (ctx.mode === "print") {
    out(ctx.applyHint);
    return 0;
  }
  if (!(await confirm(ctx, existing ? "Replace the entry and run this command?" : "Run this command?"))) return 0;

  if (existing) {
    const removed = await runCommand(io, bin, ["mcp", "remove", "--scope", scope, SERVER_NAME]);
    if (removed.code !== 0) return fail(`claude mcp remove failed (${removed.error || `exit code ${removed.code}`}).`);
  }
  const added = await runCommand(io, bin, args);
  if (added.code !== 0) return fail(`claude mcp add failed (${added.error || `exit code ${added.code}`}).`);
  out(`Done. ${signIn}`);
  return 0;
}

// Codex: `codex mcp add` then `codex mcp login`. A new Codex starts the
// sign-in inside `mcp add`. Then the CLI does not run `mcp login` again.
async function plugCodex(ctx) {
  const { io, opts, out, fail, url, token } = ctx;
  if (opts.project) return fail("Codex has no --project option here. Codex keeps MCP servers in ~/.codex/config.toml.");
  const args = ["mcp", "add", SERVER_NAME, "--url", url];
  if (token) args.push("--bearer-token-env-var", "TASKADE_TOKEN");
  const login = ["mcp", "login", SERVER_NAME];
  const file = codexConfigFile(io);
  const existing = readCodexEntry(file);
  const expected = expectedEntry("codex", url, token);

  out("Codex adds the server with its own commands:");
  out(`  ${commandLine("codex", args)}`);
  if (!token) out(`  ${commandLine("codex", login)}`);
  if (token) {
    out("Codex reads the token from TASKADE_TOKEN each time it starts. The config file holds only the variable name.");
    out("Set TASKADE_TOKEN in the environment where Codex runs.");
  }

  if (existing && deepEqual(existing, expected)) {
    out("Codex already has this taskade server. Already connected. Nothing changed.");
    if (!token) out("If Codex asks you to sign in, run: codex mcp login taskade");
    return 0;
  }
  if (existing) {
    out(`Codex already has a different server named taskade in ${tildify(io, file)}.`);
    out("Current entry:");
    out(show(existing));
    out("New entry:");
    out(show(expected));
    out("codex mcp add replaces the current entry.");
  }

  const bin = which(io, "codex");
  if (!bin) {
    out("The codex command is not on your PATH.");
    out("Install Codex (npm install -g @openai/codex, see https://github.com/openai/codex), then run the commands above.");
    return 0;
  }
  if (ctx.mode === "print") {
    out(ctx.applyHint);
    return 0;
  }
  if (!(await confirm(ctx, existing ? "Replace the entry and run these commands?" : "Run these commands?"))) return 0;

  const added = await runCommand(io, bin, args, { capture: true });
  if (added.code !== 0) return fail(`codex mcp add failed (${added.error || `exit code ${added.code}`}).`);
  if (!token && !/logged in/i.test(added.out)) {
    const signedIn = await runCommand(io, bin, login);
    if (signedIn.code !== 0) {
      return fail("The sign-in did not finish. The server is added. Run this to sign in: codex mcp login taskade");
    }
  }
  out("Done. Start Codex and type /mcp to see the taskade server.");
  return 0;
}

// VS Code without --project: its own command adds the server to the user profile.
async function plugVsCodeUser(ctx) {
  const { io, out, fail, url, token } = ctx;
  const entry = { name: SERVER_NAME, ...expectedEntry("vscode", url, token) };
  const args = ["--add-mcp", JSON.stringify(entry)];

  out("VS Code adds the server to your user profile with its own command:");
  out(`  ${commandLine("code", args)}`);
  if (token) tokenWarning(ctx, "your VS Code user profile", false);

  const bin = which(io, "code");
  if (!bin) {
    out("The code command is not on your PATH.");
    out("Add it (https://code.visualstudio.com/docs/configure/command-line), then run the command above.");
    out(`Or write .vscode/mcp.json in this folder: ${RUN} plug vscode --project`);
    return 0;
  }
  if (ctx.mode === "print") {
    out(ctx.applyHint);
    return 0;
  }
  if (!(await confirm(ctx, "Run this command?"))) return 0;
  const added = await runCommand(io, bin, args);
  if (added.code !== 0) return fail(`code --add-mcp failed (${added.error || `exit code ${added.code}`}).`);
  out(
    token
      ? "Done. Open VS Code and use the Taskade tools in Copilot Chat agent mode."
      : "Done. In VS Code, run MCP: List Servers, start taskade, and sign in when VS Code asks.",
  );
  return 0;
}

// Claude Desktop keeps a remote server as a connector in the Claude account.
// No supported file entry adds a remote server with sign-in, so the CLI
// gives the steps and copies the URL.
async function plugClaudeDesktop(ctx) {
  const { io, opts, out, fail, url, mode } = ctx;
  if (opts.project) return fail("Claude Desktop has no project file.");
  out("Claude Desktop adds a remote server as a custom connector in the app. Do these 3 steps:");
  out("  1. In Claude Desktop, open Customize, then Connectors. Older versions: Settings, then Connectors.");
  out(`  2. Click "+ Add", then "Add custom connector". Type Taskade as the name and paste ${url} as the URL.`);
  out('     Keep the default sign-in settings and click "Continue" until you can click "Add".');
  out("  3. Click Connect, sign in to Taskade, and allow access.");
  out("Claude keeps connectors in your Claude account, not in a file on this machine. This CLI cannot add one for you.");
  if (mode === "print") return 0;
  const tool = await copyToClipboard(io, url);
  out(tool ? `Copied ${url} to the clipboard (${tool}).` : "No clipboard command found. Copy the URL from step 2.");
  return 0;
}

// A client that reads a JSON file: merge one entry and keep everything else.
async function plugJsonFile(ctx, { file, key, next }) {
  const { io, opts, out, fail, url, token, client, mode } = ctx;
  const entry = expectedEntry(client.id, url, token);
  const shown = tildify(io, file);
  const block = JSON.stringify({ [key]: { [SERVER_NAME]: entry } }, null, 2);
  const config = readConfig(file, key);

  out(`${client.name} reads ${shown}.`);
  if (config.error) {
    fail(`${shown}: ${config.error}. Nothing changed.`);
    fail("Fix the file, or add this entry by hand:");
    fail(block);
    return 1;
  }
  const existing = config.data[key]?.[SERVER_NAME];
  if (existing && deepEqual(existing, entry)) {
    out("The file already has this taskade entry. Already connected. Nothing changed.");
    return 0;
  }
  if (token) tokenWarning(ctx, shown, opts.project);

  if (mode === "print") {
    if (existing) {
      out("The file has a different taskade entry:");
      out(show(existing));
      out("Replace it with this entry:");
    } else {
      out(config.exists ? "Add this entry to the file:" : "Create the file with this content:");
    }
    out(block);
    if (token) out("The block shows only the start of your token. Write the file with --yes to put the full token in it.");
    out(next);
    out(ctx.applyHint);
    return 0;
  }

  const text = mergedText(config, key, SERVER_NAME, entry);
  out(config.exists ? "The change:" : "The new file:");
  if (existing) out("The file has a different taskade entry. The - lines show it and the + lines show the new entry.");
  out(lineDiff(config.exists ? config.text : "", text));
  if (!(await confirm(ctx, `Write ${shown}?`))) return 0;

  let backup;
  try {
    backup = writeConfig(file, text, { newMode: token ? 0o600 : 0o644 });
  } catch (err) {
    return fail(`Cannot write ${shown}: ${err.message}. Nothing changed.`);
  }
  out(`Wrote ${shown}.`);
  if (backup) out(`Backup: ${tildify(io, backup)}`);
  out(next);
  return 0;
}
