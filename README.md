# @taskade/cli

Connect your AI client to Taskade with one command:

```bash
npx github:taskade/cli plug
```

The command lists the MCP clients on your machine and the command to run for each. It changes nothing.

> **Not on npm yet.** Until the first npm release, run the CLI from GitHub with `npx github:taskade/cli`. After that release, `npx @taskade/cli` works too.

## Most people need no CLI

Paste this line into your agent. The agent reads the steps and connects itself:

```text
Set up Taskade for me. Read and follow https://www.taskade.com/SKILL.md
```

- The Taskade skills: [taskade/skills](https://github.com/taskade/skills)
- The Taskade MCP server and plugin: [taskade/mcp](https://github.com/taskade/mcp)
- The hosted server guide: [Hosted Taskade MCP](https://www.taskade.com/docs/mcp/hosted-mcp)

The hosted server is `https://www.taskade.com/mcp`. It is part of every paid Taskade plan. Clients sign in with your Taskade account in the browser (OAuth), so you need no token.

## Connect a client: `plug`

```bash
npx github:taskade/cli plug claude-code
npx github:taskade/cli plug codex
npx github:taskade/cli plug cursor
npx github:taskade/cli plug vscode
npx github:taskade/cli plug claude-desktop
```

Each command shows the change first. In a terminal, it asks for a "y" before it changes anything. On a pipe or in CI, it only prints. `connect` is an alias of `plug`, and `claude` is an alias of `claude-code`.

| Client | What the CLI does | What changes on your machine |
| --- | --- | --- |
| `claude-code` | Runs `claude mcp add --transport http --scope user taskade https://www.taskade.com/mcp`. | Claude Code adds the server to `~/.claude.json`. With `--project`, it writes `.mcp.json` in the current folder. |
| `codex` | Runs `codex mcp add taskade --url https://www.taskade.com/mcp`, then `codex mcp login taskade` if the add step did not sign you in. | Codex adds the server to `~/.codex/config.toml` and keeps the sign-in. |
| `cursor` | Merges one `taskade` entry into the Cursor config file. | `~/.cursor/mcp.json`, or `.cursor/mcp.json` in the current folder with `--project`. |
| `vscode` | Runs `code --add-mcp` with the `taskade` entry. With `--project`, merges one entry into the file. | Your VS Code user profile, or `.vscode/mcp.json` in the current folder with `--project`. |
| `claude-desktop` | Prints the 3 steps for the Connectors screen and copies the URL to the clipboard. | Only the clipboard. Claude keeps connectors in your Claude account, not in a file, so the CLI cannot add one for you. |

When a client command (`claude`, `codex`, `code`) is not on your PATH, the CLI prints the command and the install step, and exits 0.

When the CLI changes a JSON file, it:

- Shows the file and the exact change as a diff.
- Keeps every other key and every other server, and the format of the rest of the file.
- Writes a backup copy beside the file first (`<file>.bak-<timestamp>`).
- Writes a temp file, then renames it over the file. The file keeps its mode.
- Refuses a file that is not valid JSON and leaves it unchanged. (JSON with comments counts as not valid.)
- Says "Already connected" and changes nothing when an equal `taskade` entry exists. When a different entry exists, it shows both and asks.

Run `plug` with no client name to see which clients are on your machine.

### Options for `plug`

| Option | Effect |
| --- | --- |
| `--yes`, `-y` | Apply the change with no question. |
| `--print` | Show the command or the config block. Change nothing. This is the default on a pipe or in CI. |
| `--project` | Write the project file of the current folder, not the user file (Claude Code, Cursor, VS Code). |
| `--token` | Use a personal access token in place of the browser sign-in. See below. |

### A machine with no browser: `--token`

A headless machine cannot sign in with a browser. Create a personal access token at [https://www.taskade.com/settings/api](https://www.taskade.com/settings/api), put it in the environment variable `TASKADE_TOKEN`, and add `--token`:

```bash
export TASKADE_TOKEN=...   # your token
npx github:taskade/cli plug cursor --token
```

- The CLI reads the token only from `TASKADE_TOKEN`. It refuses a token on the command line, because your shell history keeps it.
- The CLI never prints the full token. It shows the first 6 characters and "…".
- The config file then holds your token, and anyone who can read the file can use your Taskade account. A new file gets mode 600. Do not commit a project file that holds a token.
- Codex keeps only the name `TASKADE_TOKEN` in its config and reads the token from the environment each time it starts.
- Claude Desktop takes no token from the CLI.

## Check a connection: `doctor`

```bash
npx github:taskade/cli doctor
```

`doctor` answers "why does my connection fail?" in plain lines. Each line starts with `ok`, `fail`, or `--` (skipped), and a failed line gives the next step. It changes nothing on your machine. `whoami` is an alias of `doctor`.

It checks:

1. The Node.js version.
2. The server: a request with no sign-in must return 401 with a `www-authenticate` header that names the sign-in metadata. It then reads that metadata and the metadata of the authorization server.
3. With `TASKADE_TOKEN` set: an MCP `initialize` request and a `tools/list` request with your token. It reports that the token works and the server lists its tools, or the exact refusal of the server.
4. The clients on your machine, and whether each one has a `taskade` server entry. It only reads the files.

Example, with a token that the server does not accept:

```text
ok    The server answers. Without sign-in it returns 401 and names its sign-in metadata.
ok    Sign-in metadata: https://www.taskade.com/mcp/.well-known/oauth-protected-resource
ok    Authorization server: https://www.taskade.com/.well-known/oauth-authorization-server

fail  The server refused the token (401: Invalid or expired token).
      Next: Create a new token at https://www.taskade.com/settings/api and set TASKADE_TOKEN to it.
```

| Option | Effect |
| --- | --- |
| `--json` | Print the result as JSON, for scripts. |
| `--verbose` | Print the names of the tools that the server lists. |

The exit code is 0 when every check passes and 1 when a check fails. `doctor` sends your token only to the server URL, and it does not follow a redirect with the token.

## Environment

| Variable | Use |
| --- | --- |
| `TASKADE_TOKEN` | A personal access token. `plug` reads it only with `--token`. `doctor` uses it for the token check. |
| `TASKADE_MCP_URL` | Another server URL, for tests. It must use `https://`, except for `localhost` and `127.0.0.1`. |

## Other commands

| Command | Effect |
| --- | --- |
| `help`, `--help`, `-h` | Show the help. |
| `--version`, `-v` | Show the version. |

An unknown command prints a short message and exits 1.

## Requirements

Node.js 18 or later. The CLI has no dependencies.

## For maintainers

Run the tests with `npm test`. The tests use a temporary HOME and PATH, fake client commands, and a fake MCP server on `127.0.0.1`. They never touch the config of your machine.

To release a version:

1. Set the version in `package.json` and add a section to `CHANGELOG.md`.
2. Change the examples in this README and the `RUN` constant in `src/clients.mjs` from `npx github:taskade/cli` to `npx @taskade/cli` (once, with the first npm release).
3. Publish a GitHub release with the tag `v<version>`. The `Release` workflow checks that the tag equals the version, runs the tests, and publishes to npm with provenance.

The `Release` workflow uses npm trusted publishing (OIDC), so the repository holds no npm token. It cannot work before these two steps, which an owner of the npm scope must do once:

1. Publish the first version by hand from a clean checkout: `npm publish --access public`.
2. On npmjs.com, open the settings of `@taskade/cli` and add a trusted publisher: GitHub Actions, organization `taskade`, repository `cli`, workflow `release.yml`.

## Security

Report a vulnerability to security@taskade.com. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
