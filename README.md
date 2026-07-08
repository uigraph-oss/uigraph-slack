# uigraph-slack

[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Ask your architecture questions from Slack. `uigraph-slack` is a bot for [UiGraph](https://github.com/uigraph-oss) that answers questions like *"how does billing talk to the ledger DB?"* by reasoning over your own architecture data — services, diagrams, system maps, API specs, and schemas — via [uigraph-mcp](https://github.com/uigraph-oss/uigraph-mcp).

It's built for **self-hosted** UiGraph deployments: it talks to your own `uigraph-mcp` instance over the network, and connects to Slack in Socket Mode so you never need to expose a public webhook endpoint.

> **Status:** this repo currently contains architecture and setup documentation only. The reference implementation (bolt-js) is coming in a follow-up phase — see [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical spec a contributor can build against.

## How it works

```
                          ┌─────────────────────────┐
   Slack workspace        │      uigraph-slack       │        Your self-hosted UiGraph
 ┌────────────────┐  WSS  │  ┌────────────────────┐  │  HTTP   ┌──────────────┐
 │ @uigraph mention │────▶│  │  bolt-js (Socket    │  │───────▶│  uigraph-mcp  │
 │ or DM             │◀────│  │  Mode) + reasoning  │  │◀───────│  (MCP tools)  │
 └────────────────┘        │  │  loop               │  │        └──────┬───────┘
                          │  └──────────┬─────────┘  │               │
                          │             │ tool-calling │               ▼
                          │             ▼             │        uigraph-api / postgres
                          │  ┌────────────────────┐   │
                          │  │  LLM provider        │   │
                          │  │  (BYO key: Anthropic, │   │
                          │  │   OpenAI, or custom)  │   │
                          │  └────────────────────┘   │
                          └─────────────────────────┘
```

A question mentioning the bot triggers a bounded tool-calling loop: the configured LLM decides which `uigraph-mcp` tools to call (e.g. `list_services` → `get_service_context` → `get_diagram`), and the bot formats the result as a threaded Slack reply with links back into your UiGraph instance.

## Features

- **Slack-native Q&A** — `@mention` the bot in a channel or DM it; replies are threaded so conversations stay coherent
- **Self-hosted by design** — Socket Mode means no public ingress required; every deployment talks to your own `uigraph-mcp`
- **Org-scoped** — a UiGraph service-account token per organization keeps answers scoped to the right tenant; see [ARCHITECTURE.md](ARCHITECTURE.md#mcp-integration) for the exact model
- **BYO LLM** — pluggable provider (Anthropic, OpenAI, or any OpenAI-compatible endpoint) so architecture data and questions only egress to a provider you choose
- **Least-privilege by default** — narrow Slack OAuth scopes and read-only UiGraph scopes; see [SECURITY.md](SECURITY.md)

## Quickstart

Requires a running `uigraph-mcp` instance (see [uigraph-deploy](https://github.com/uigraph-oss/uigraph-deploy)) and a Slack app configured for Socket Mode — the full walkthrough is in [SETUP.md](SETUP.md).

```yaml
# add to your uigraph-deploy docker-compose.yml (or run standalone)
uigraph-slack:
  image: uigraph/uigraph-slack:latest
  restart: unless-stopped
  environment:
    SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}'
    SLACK_APP_TOKEN: '${SLACK_APP_TOKEN}'
    UIGRAPH_MCP_URL: 'http://uigraph-mcp:8080'
    UIGRAPH_SERVICE_TOKEN: '${UIGRAPH_SERVICE_TOKEN}'
    UIGRAPH_ORG_ID: '${UIGRAPH_ORG_ID}'
    LLM_PROVIDER: 'anthropic'
    ANTHROPIC_API_KEY: '${ANTHROPIC_API_KEY}'
  depends_on:
    uigraph-mcp: { condition: service_healthy }
# uses the same `uigraph` network already defined in uigraph-deploy's docker-compose.yml
```

See [SETUP.md](SETUP.md) for creating the Slack app, minting a `uigraph-mcp` service-account token, and the full environment variable reference.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the bot works end-to-end: Slack surfaces, transport modes, MCP integration, the reasoning loop, LLM provider abstraction
- [SETUP.md](SETUP.md) — step-by-step self-hosting guide
- [SECURITY.md](SECURITY.md) — threat model, scopes, secrets, data egress

## License

This project is licensed under the [Apache License 2.0](LICENSE). Unlike the core UiGraph platform (BUSL-1.1), this integration layer is permissively licensed to make it as easy as possible for the community to contribute Slack features, additional LLM providers, and fixes.

## Related projects

- [uigraph-mcp](https://github.com/uigraph-oss/uigraph-mcp) — MCP server for AI assistants
- [uigraph-api](https://github.com/uigraph-oss/uigraph-api) — backend API
- [uigraph-ui](https://github.com/uigraph-oss/uigraph-ui) — web application
- [uigraph-graphql](https://github.com/uigraph-oss/uigraph-graphql) — GraphQL BFF
- [uigraph-gateway](https://github.com/uigraph-oss/uigraph-gateway) — CLI sync API
- [uigraph-sdk](https://github.com/uigraph-oss/uigraph-sdk) — TypeScript SDK
- [uigraph-deploy](https://github.com/uigraph-oss/uigraph-deploy) — self-hosted deployment
