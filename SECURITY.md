# Security policy

## Report a vulnerability

Send an email to security@taskade.com. Do not open a public issue for a vulnerability.

Include:

- The version of `@taskade/cli` and of Node.js.
- The steps to reproduce the problem.
- The effect that you saw.

We answer each report, and we tell you when a release includes the fix.

## Supported versions

We fix security problems in the newest release only.

## How the CLI handles a token

- The CLI reads a personal access token only from the environment variable `TASKADE_TOKEN`. It refuses a token on the command line.
- It never prints the full token.
- It sends the token only to the server URL, only over `https://` (or to `localhost` for tests), and it does not follow a redirect with the token.
- `plug --token` writes the token into the config file of the client. Treat that file as a secret.
