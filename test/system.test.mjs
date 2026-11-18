import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { askOnTerminal, mask } from "../src/system.mjs";

async function ask(typed) {
  const input = new PassThrough();
  const output = new PassThrough();
  const answer = askOnTerminal("Write? [y/N] ", input, output);
  if (typed === null) input.end();
  else input.write(typed);
  return answer;
}

test("the prompt takes only y or yes as a yes", async () => {
  assert.equal(await ask("y\n"), true);
  assert.equal(await ask("YES\n"), true);
  assert.equal(await ask("n\n"), false);
  assert.equal(await ask("\n"), false);
  assert.equal(await ask("yep\n"), false);
  assert.equal(await ask(null), false, "end of input is a no");
});

test("mask shows only the first 6 characters", () => {
  assert.equal(mask("tskdp_abcdefghijkl"), "tskdp_…");
});
