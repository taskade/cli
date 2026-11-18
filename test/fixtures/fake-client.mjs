// A fake client command (claude, codex, code) or clipboard command for the tests.
// It records its arguments and its stdin in FAKE_LOG_DIR/<name>.log, one JSON line
// for each call, prints FAKE_<NAME>_STDOUT, and exits with FAKE_<NAME>_EXIT.

import { appendFileSync } from "node:fs";
import { join } from "node:path";

const [name, ...args] = process.argv.slice(2);
const key = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

let input = "";
if (process.env[`FAKE_${key}_STDIN`] === "1") {
  for await (const chunk of process.stdin) input += chunk;
}
appendFileSync(join(process.env.FAKE_LOG_DIR, `${name}.log`), JSON.stringify({ args, input }) + "\n");
if (process.env[`FAKE_${key}_STDOUT`]) process.stdout.write(process.env[`FAKE_${key}_STDOUT`] + "\n");
process.exitCode = Number(process.env[`FAKE_${key}_EXIT`] || 0);
