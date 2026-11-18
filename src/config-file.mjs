// Read and change a JSON config file that holds MCP servers.
// The rules: keep every other key and server, write a backup first,
// write through a temp file and a rename, keep the file mode, and never
// overwrite a file that is not valid JSON.

import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Read a JSON config file.
 * Returns { exists, data, text, error }. `error` is set when the file exists
 * but is not a JSON object, or when `key` is not an object.
 */
export function readConfig(file, key) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { exists: false, data: {}, text: "" };
    return { exists: true, error: `cannot read the file (${err.code || err.message})` };
  }
  if (text.trim() === "") return { exists: true, data: {}, text };
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { exists: true, text, error: `the file is not valid JSON (${err.message})` };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { exists: true, text, error: "the file does not hold a JSON object" };
  }
  const servers = data[key];
  if (servers !== undefined && (servers === null || typeof servers !== "object" || Array.isArray(servers))) {
    return { exists: true, text, error: `"${key}" in the file is not a JSON object` };
  }
  return { exists: true, data, text };
}

export function deepEqual(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

/** The indent of the file: the whitespace of its first indented line, or 2 spaces. */
function detectIndent(text) {
  const match = /^([ \t]+)\S/m.exec(text);
  return match ? match[1] : "  ";
}

/**
 * The new text of the file with `data[key][name] = entry`.
 * It changes only the text of that one entry, so the rest of the file keeps
 * its format. If that edit does not give the expected data, it writes the
 * whole file again with JSON.stringify.
 */
export function mergedText(config, key, name, entry) {
  const data = config.data;
  const next = { ...data, [key]: { ...(data[key] || {}), [name]: entry } };
  if (!config.exists || config.text.trim() === "") return JSON.stringify(next, null, "  ") + "\n";
  try {
    const text = editInPlace(config.text, key, name, entry);
    if (deepEqual(JSON.parse(text), next)) return text;
  } catch {
    // Fall back to a full write below.
  }
  const newline = config.text.endsWith("\n") ? "\n" : "";
  return JSON.stringify(next, null, detectIndent(config.text)) + newline;
}

/** Parse valid JSON text into spans: each object holds its members with their positions. */
function parseSpans(text) {
  let i = 0;
  const skip = () => {
    while (/\s/.test(text[i] || "")) i++;
  };
  const string = () => {
    const start = i++;
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return { start, end: i };
  };
  const value = () => {
    skip();
    const start = i;
    if (text[i] === "{" || text[i] === "[") {
      const object = text[i] === "{";
      const members = [];
      i++;
      skip();
      if (text[i] === (object ? "}" : "]")) return { start, end: ++i, members };
      for (;;) {
        skip();
        if (object) {
          const k = string();
          skip();
          i++; // the colon
          members.push({ key: JSON.parse(text.slice(k.start, k.end)), value: value() });
        } else {
          value();
        }
        skip();
        if (text[i++] !== ",") return { start, end: i, members };
      }
    }
    if (text[i] === '"') return string();
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
    return { start, end: i };
  };
  return value();
}

function lineIndent(text, pos) {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))[0];
}

/** Indent every line after the first of a JSON text. */
function reindent(json, indent, eol) {
  return json.replace(/\n/g, eol + indent);
}

/** Insert `"name": value` as the last member of the object at `span`. */
function insertMember(text, span, name, value, unit, eol) {
  const outer = lineIndent(text, span.end - 1);
  const inner = span.members.length ? lineIndent(text, span.members[0].value.start) : outer + unit;
  const member = `${JSON.stringify(name)}: ${reindent(JSON.stringify(value, null, unit), inner, eol)}`;
  const close = span.end - 1;
  if (!span.members.length) return `${text.slice(0, span.start + 1)}${eol}${inner}${member}${eol}${outer}${text.slice(close)}`;
  const last = span.members[span.members.length - 1].value.end;
  return `${text.slice(0, last)},${eol}${inner}${member}${text.slice(last)}`;
}

function editInPlace(text, key, name, entry) {
  const root = parseSpans(text);
  const unit = detectIndent(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const servers = root.members.find((m) => m.key === key);
  if (!servers) return insertMember(text, root, key, { [name]: entry }, unit, eol);
  const existing = servers.value.members.find((m) => m.key === name);
  if (!existing) return insertMember(text, servers.value, name, entry, unit, eol);
  const indent = lineIndent(text, existing.value.start);
  const json = reindent(JSON.stringify(entry, null, unit), indent, eol);
  return text.slice(0, existing.value.start) + json + text.slice(existing.value.end);
}

/**
 * A line diff of two texts, with 2 lines of context around each change.
 * Lines that only the new text has start with "+", removed lines with "-".
 */
export function lineDiff(oldText, newText) {
  const a = oldText === "" ? [] : oldText.replace(/\r?\n$/, "").split(/\r?\n/);
  const b = newText.replace(/\r?\n$/, "").split(/\r?\n/);
  // Longest common subsequence table, built from the end.
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push([" ", a[i]]);
      i++;
      j++;
    } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      // Show a removed line before the lines that replace it.
      ops.push(["-", a[i]]);
      i++;
    } else {
      ops.push(["+", b[j]]);
      j++;
    }
  }
  const keep = ops.map(([op], n) => ops.slice(Math.max(0, n - 2), n + 3).some(([o]) => o !== " "));
  const lines = [];
  let skipped = false;
  ops.forEach(([op, text], n) => {
    if (keep[n]) {
      if (skipped) lines.push("  ...");
      skipped = false;
      lines.push(`${op} ${text}`);
    } else {
      skipped = true;
    }
  });
  if (skipped) lines.push("  ...");
  return lines.join("\n");
}

/** Never overwrite an older backup: add -2, -3 and on when the name is taken. */
function freeBackupPath(base) {
  let candidate = base;
  for (let n = 2; existsSync(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

function timestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/**
 * Write `text` to `file`. Writes a backup of an existing file first, then a
 * temp file beside it, then renames the temp file over the file.
 * Keeps the mode of an existing file. A new file gets `newMode`.
 * Returns the path of the backup, or null for a new file.
 */
export function writeConfig(file, text, { newMode = 0o644, now = new Date() } = {}) {
  let target = file;
  let mode = newMode;
  let backup = null;
  try {
    // Write through a symbolic link to the real file, as an editor does.
    target = realpathSync(file);
    mode = statSync(target).mode & 0o777;
    backup = freeBackupPath(`${file}.bak-${timestamp(now)}`);
    copyFileSync(target, backup, constants.COPYFILE_EXCL);
    chmodSync(backup, mode);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    mkdirSync(dirname(file), { recursive: true });
  }
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, text, { mode });
    chmodSync(temp, mode);
    renameSync(temp, target);
  } catch (err) {
    try {
      unlinkSync(temp);
    } catch {
      // The temp file was never written.
    }
    throw err;
  }
  return backup;
}
