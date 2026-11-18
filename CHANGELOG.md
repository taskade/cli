# Changelog

## 0.2.0

### Added

- `plug <client>` connects Claude Code, Codex, Cursor, VS Code, or Claude Desktop to `https://www.taskade.com/mcp`. The default is the browser sign-in (OAuth), with no token.
- For Claude Code, Codex, and VS Code, `plug` shows the command of the client and runs it after a "y".
- For Cursor and for `vscode --project`, `plug` merges one `taskade` entry into the JSON config file. It shows a diff, writes a backup, writes atomically, keeps the file mode and the format of the rest of the file, and refuses a file that is not valid JSON.
- For Claude Desktop, `plug` prints the 3 steps for the Connectors screen and copies the URL to the clipboard.
- `plug` with no client lists the clients on the machine and changes nothing.
- `--yes`, `--print`, `--project`, and `--token`. `--token` reads a personal access token from `TASKADE_TOKEN` only, and never prints the full token.
- `doctor` checks the Node.js version, the server and its sign-in metadata, the token with an MCP `initialize` and `tools/list` request, and the client config files. `--json` prints the result as JSON. `--verbose` prints the tool names.
- `connect` is an alias of `plug`. `claude` is an alias of `claude-code`.
- `--version`.
- CI on Node.js 18, 20, 22, and 24 on Linux, and Node.js 22 on macOS and Windows.
- A release workflow that publishes to npm with provenance through npm trusted publishing.
- `SECURITY.md`.

### Changed

- `whoami` is now an alias of `doctor`. The old `whoami` called an API path that does not exist and always failed with 404.
- `plug` no longer asks for a token, and the default config holds no token.
- `npm test` lists the test files, so it works on every supported Node.js version.
- The copyright holder in `LICENSE` is TASKCADE INC.

### Removed

- `TASKADE_API_URL`. `TASKADE_MCP_URL` sets another server URL for tests.

## 0.1.0

- `plug [cursor|claude]` printed a config block with a personal access token.
- `whoami` called an API path that does not exist.
