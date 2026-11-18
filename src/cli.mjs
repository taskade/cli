// Parse the command line and run one command.
// `main` takes all input from `io`, so that the tests can run it in process.

import { readFileSync } from "node:fs";
import { CLIENTS, DEFAULT_SERVER_URL, RUN, findClient } from "./clients.mjs";
import { doctor } from "./doctor.mjs";
import { plug } from "./plug.mjs";

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const FLAGS = {
  "--yes": "yes",
  "-y": "yes",
  "--print": "print",
  "--project": "project",
  "--token": "token",
  "--json": "json",
  "--verbose": "verbose",
  "--help": "help",
  "-h": "help",
  "--version": "version",
  "-v": "version",
};

const COMMAND_FLAGS = {
  plug: ["yes", "print", "project", "token"],
  doctor: ["json", "verbose"],
};

const TOKEN_REFUSAL =
  "Never pass a token on the command line. It stays in your shell history.\n" +
  "Set the environment variable TASKADE_TOKEN, then add --token.";

export function helpText() {
  const clients = CLIENTS.map((c) => c.id + (c.aliases.length ? ` (${c.aliases.join(", ")})` : "")).join(", ");
  return `taskade ${VERSION}: connect an MCP client to Taskade

USAGE
  ${RUN} <command> [options]

COMMANDS
  plug [client]   Connect a client to ${DEFAULT_SERVER_URL}.
                  With no client, list the clients on this machine.
                  Alias: connect
  doctor          Check why a connection fails. Changes nothing.
                  Alias: whoami
  help            Show this help.

CLIENTS
  ${clients}

PLUG OPTIONS
  --yes       Apply the change with no question.
  --print     Show the command or the config block. Change nothing.
              This is the default when the CLI does not run in a terminal.
  --project   Write the project file of this folder, not the user file.
  --token     Send a personal access token from TASKADE_TOKEN in a header,
              for a machine that cannot sign in with a browser.

DOCTOR OPTIONS
  --json      Print the result as JSON.
  --verbose   Print the names of the tools that the server lists.

OTHER OPTIONS
  --help, -h      Show this help.
  --version, -v   Show the version.

ENVIRONMENT
  TASKADE_TOKEN     A personal access token, read only with --token and by doctor.
                    Create one at https://www.taskade.com/settings/api
  TASKADE_MCP_URL   Another server URL, for tests. https:// only, except
                    for localhost and 127.0.0.1.

Most people need no CLI. Paste this into your agent:
  Set up Taskade for me. Read and follow https://www.taskade.com/SKILL.md
`;
}

export function parseArgs(argv) {
  const opts = {};
  const positionals = [];
  for (const arg of argv) {
    if (arg.startsWith("--token=")) return { error: TOKEN_REFUSAL };
    if (/^tskdp_/i.test(arg)) return { error: TOKEN_REFUSAL };
    if (arg.startsWith("-")) {
      const flag = FLAGS[arg];
      if (!flag) return { error: `Unknown option: ${arg}` };
      opts[flag] = true;
    } else {
      positionals.push(arg);
    }
  }
  return { opts, positionals };
}

/**
 * Run the CLI. `io` holds: env, cwd, platform, interactive, version,
 * stdout and stderr (objects with a write method), and ask (question -> Promise<boolean>).
 * Returns the exit code.
 */
export async function main(argv, io) {
  io = { version: VERSION, ...io };
  const parsed = parseArgs(argv);
  if (parsed.error) {
    io.stderr.write(parsed.error + "\n");
    return 1;
  }
  const { opts, positionals } = parsed;
  if (opts.version) {
    io.stdout.write(VERSION + "\n");
    return 0;
  }
  const [command, ...rest] = positionals;
  if (opts.help || command === undefined || command === "help") {
    io.stdout.write(helpText());
    return 0;
  }

  const name = { connect: "plug", whoami: "doctor" }[command] || command;
  if (!COMMAND_FLAGS[name]) {
    io.stderr.write(`Unknown command: ${command}\nRun "${RUN} help" to see the commands.\n`);
    return 1;
  }
  const wrong = Object.keys(opts).find((flag) => !COMMAND_FLAGS[name].includes(flag));
  if (wrong) {
    io.stderr.write(`The option --${wrong} does not apply to ${command}.\n`);
    return 1;
  }
  // With --token, a word that is not a client name can be the token itself. Do not echo it.
  if (opts.token && (rest.length > 1 || (rest[0] && !findClient(rest[0])))) {
    io.stderr.write(TOKEN_REFUSAL + "\n");
    return 1;
  }
  const maxArgs = name === "plug" ? 1 : 0;
  if (rest.length > maxArgs) {
    io.stderr.write(`Too many arguments for ${command}: ${rest.slice(maxArgs).join(" ")}\n`);
    return 1;
  }
  if (opts.print && opts.yes) {
    io.stderr.write("Use --print or --yes, not both.\n");
    return 1;
  }

  if (name === "plug") return plug(io, { ...opts, client: rest[0] });
  return doctor(io, opts);
}
