// Small helpers that touch the machine: PATH lookup, child processes,
// the terminal prompt, the clipboard, and paths in the home folder.
// Every helper reads the environment from `io.env`, not from `process.env`,
// so that the tests can give the CLI a temporary HOME and PATH.

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

/** Read an environment variable without regard to case on Windows. */
export function getEnv(env, name) {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/** The home folder of the user. HOME on macOS and Linux, USERPROFILE on Windows. */
export function homeDir(io) {
  const value = io.platform === "win32" ? getEnv(io.env, "USERPROFILE") : getEnv(io.env, "HOME");
  return value || homedir();
}

/** Show a path with ~ for the home folder. */
export function tildify(io, file) {
  const home = homeDir(io);
  return file.startsWith(home + (io.platform === "win32" ? "\\" : "/")) ? "~" + file.slice(home.length) : file;
}

/** Find a command on PATH. Returns the full path, or null. */
export function which(io, name) {
  const dirs = (getEnv(io.env, "PATH") || "").split(io.platform === "win32" ? ";" : delimiter).filter(Boolean);
  const exts =
    io.platform === "win32" ? (getEnv(io.env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext.toLowerCase());
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Not in this folder.
      }
    }
  }
  return null;
}

export function exists(file) {
  return existsSync(file);
}

// cmd.exe gives a special meaning to these characters even inside quotes.
const CMD_UNSAFE = /[%^&|<>!\r\n]/;

function quoteForCmd(arg) {
  if (/^[\w\-.:/=@]+$/.test(arg)) return arg;
  return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1") + '"';
}

/**
 * Run a command with the terminal of the user. Returns the exit code and,
 * when `capture` is true, the text that the command wrote to stdout.
 * The captured text is also shown to the user as it arrives.
 */
export function runCommand(io, file, args, { capture = false } = {}) {
  return new Promise((resolve) => {
    let child;
    const stdio = ["inherit", capture ? "pipe" : "inherit", "inherit"];
    // Windows runs a .cmd or .bat file only through cmd.exe.
    if (io.platform === "win32" && /\.(cmd|bat)$/i.test(file)) {
      if ([file, ...args].some((a) => CMD_UNSAFE.test(a))) {
        resolve({ code: -1, out: "", error: "an argument holds a character that cmd.exe changes" });
        return;
      }
      const line = [file, ...args].map(quoteForCmd).join(" ");
      child = spawn(line, { env: io.env, cwd: io.cwd, stdio, shell: true, windowsHide: true });
    } else {
      child = spawn(file, args, { env: io.env, cwd: io.cwd, stdio });
    }
    let out = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        out += chunk;
        io.stdout.write(chunk);
      });
    }
    child.on("error", (err) => resolve({ code: -1, out, error: err.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

/** Copy text to the clipboard. Returns the name of the command, or null. */
export async function copyToClipboard(io, text) {
  const candidates =
    io.platform === "darwin"
      ? [["pbcopy", []]]
      : io.platform === "win32"
        ? [["clip", []]]
        : [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard"]],
          ];
  for (const [name, args] of candidates) {
    if (name === "wl-copy" && !getEnv(io.env, "WAYLAND_DISPLAY")) continue;
    const file = which(io, name);
    if (!file) continue;
    const ok = await new Promise((resolve) => {
      const shell = io.platform === "win32" && /\.(cmd|bat)$/i.test(file);
      const child = spawn(shell ? `"${file}"` : file, args, {
        env: io.env,
        stdio: ["pipe", "ignore", "ignore"],
        shell,
        windowsHide: true,
      });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
      child.stdin.end(text);
    });
    if (ok) return name;
  }
  return null;
}

/** Ask a yes or no question on the terminal. Only "y" or "yes" is a yes. */
export function askOnTerminal(question, input = process.stdin, output = process.stderr) {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    // Resolve before close: close() emits "close" at once, and that handler means "no answer".
    rl.question(question, (answer) => {
      resolve(/^y(es)?$/i.test(answer.trim()));
      rl.close();
    });
    rl.on("close", () => resolve(false));
  });
}

/** Show the first 6 characters of a secret and an ellipsis. */
export function mask(secret) {
  return secret.slice(0, 6) + "…";
}
