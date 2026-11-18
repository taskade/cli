#!/usr/bin/env node

// @taskade/cli: connect an MCP client to Taskade, and check the connection.
// Run `taskade help` for the commands.

import { main } from "../src/cli.mjs";
import { askOnTerminal } from "../src/system.mjs";

main(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  platform: process.platform,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  stdout: process.stdout,
  stderr: process.stderr,
  ask: askOnTerminal,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  },
);
