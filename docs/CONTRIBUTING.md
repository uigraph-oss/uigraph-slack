# Contributing

Thanks for your interest in `uigraph-slack`.

## License

Unlike most of the [uigraph-oss](https://github.com/uigraph-oss) org, which is licensed under BUSL-1.1, **this repo is Apache-2.0** (see [LICENSE](LICENSE)). Contributions you submit are accepted under those terms — don't assume BUSL-1.1 applies here.

## Current status

This repo currently contains architecture and setup documentation (see [ARCHITECTURE.md](ARCHITECTURE.md) and [SETUP.md](SETUP.md)) ahead of the reference implementation. If you'd like to help build it, open an issue first to coordinate — the reasoning loop, MCP client integration, and Slack event handling described in ARCHITECTURE.md are the core pieces to start with.

## Reporting bugs and requesting features

Open a GitHub issue with as much detail as you can: what you expected, what happened, and relevant logs (redact any tokens or Slack content first).

## Reporting security issues

Do not open a public issue for security vulnerabilities — see [SECURITY.md](SECURITY.md#reporting-a-vulnerability) for the private reporting process.

## Pull requests

- Keep changes focused — a PR that does one thing is easier to review than one that bundles several.
- If you're changing documented behavior (env vars, scopes, tool mappings), update the relevant doc (`ARCHITECTURE.md`, `SETUP.md`, or `SECURITY.md`) in the same PR.
- Describe the "why" in your PR description, not just the "what" — the diff already shows what changed.
