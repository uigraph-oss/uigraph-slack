# Self-hosting setup

Step-by-step guide to running `uigraph-slack` against your self-hosted UiGraph instance. See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works; this doc is the "how to configure it" companion.

## Prerequisites

- A running `uigraph-mcp` instance, reachable from wherever you'll run this bot. If you don't have one yet, see [uigraph-deploy](https://github.com/uigraph-oss/uigraph-deploy) — `uigraph-mcp` isn't in that repo's `docker-compose.yml` by default today, so add it alongside the existing services, pointed at your `uigraph-api`.
- A Slack workspace where you can create and install apps.
- Docker, or a Node.js runtime if running the bot outside a container.

## 1. Create the Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**, select your workspace, and paste the following (adjust the name/description as you like):

```yaml
display_information:
  name: UiGraph
  description: Ask questions about your architecture, right from Slack.
  background_color: "#1a1a2e"
features:
  bot_user:
    display_name: uigraph
    always_online: true
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - im:history
      - im:read
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.im
  interactivity:
    is_enabled: false
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

This manifest already encodes the least-privilege scopes and event subscriptions from [SECURITY.md](SECURITY.md) — no `channels:history` or other blanket read scopes are needed, since the bot only ever sees the specific message that mentioned it.

## 2. Enable Socket Mode and generate tokens

1. Under **Socket Mode**, toggle it on.
2. Under **Basic Information → App-Level Tokens**, generate a token with the `connections:write` scope. This is your `SLACK_APP_TOKEN` (`xapp-...`).
3. Under **OAuth & Permissions**, click **Install to Workspace**. Copy the **Bot User OAuth Token** — this is your `SLACK_BOT_TOKEN` (`xoxb-...`).

## 3. Mint a uigraph-mcp service-account token

In the UiGraph UI, go to your organization's **Settings → Service Accounts → Create Service Account**. Name it something like `slack-bot`, and grant exactly these scopes — the read-only subset this bot needs, nothing more:

| Scope | Why |
|---|---|
| `services:read` | `list_services`, `get_service`, `get_service_context` |
| `diagrams:read` | `list_diagrams`, `get_diagram` |
| `maps:read` | `list_maps`, `get_map` |
| `docs:read` | documentation content surfaced through `get_service_context` |
| `folders:read` | `list_folders` |

Create a token for the service account — the plaintext (`uig_...`) is shown once, so copy it immediately. This is your `UIGRAPH_SERVICE_TOKEN`. Note the organization's ID as well — this is your `UIGRAPH_ORG_ID`.

Verify the token before wiring it into the bot:

```bash
curl -s https://your-uigraph-mcp-host/auth/me \
  -H "Authorization: Bearer uig_..." | jq
```

A healthy response returns the identity and org(s) resolved for that token. If this fails, double-check the token wasn't truncated when copied and that it hasn't been revoked.

## 4. Configure the LLM provider

Pick a provider and set its credentials — the bot will not start without one configured (see [ARCHITECTURE.md](ARCHITECTURE.md#llm-provider-abstraction) for the full rationale):

- **Anthropic** (recommended): `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...`. Default model `claude-opus-4-8`; for a high-volume bot, set `LLM_MODEL=claude-sonnet-5` for better cost/latency.
- **OpenAI**: `LLM_PROVIDER=openai`, `OPENAI_API_KEY=...`, `LLM_MODEL=...`.
- **Custom / self-hosted, OpenAI-compatible**: `LLM_PROVIDER=custom`, `LLM_BASE_URL=...`, `LLM_API_KEY=...`, `LLM_MODEL=...` — for data-residency-sensitive deployments routing through a private or regional gateway.

## 5. Add the service to your compose stack

```yaml
uigraph-slack:
  image: uigraph/uigraph-slack:latest
  restart: unless-stopped
  environment:
    SLACK_MODE: 'socket'
    SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}'
    SLACK_APP_TOKEN: '${SLACK_APP_TOKEN}'
    UIGRAPH_MCP_URL: 'http://uigraph-mcp:8080'
    UIGRAPH_SERVICE_TOKEN: '${UIGRAPH_SERVICE_TOKEN}'
    UIGRAPH_ORG_ID: '${UIGRAPH_ORG_ID}'
    UIGRAPH_FRONTEND_URL: 'http://localhost:3000'
    LLM_PROVIDER: 'anthropic'
    ANTHROPIC_API_KEY: '${ANTHROPIC_API_KEY}'
    LLM_MODEL: 'claude-sonnet-5'
  depends_on:
    uigraph-mcp: { condition: service_healthy }
  healthcheck:
    test: ['CMD-SHELL', 'wget -qO- http://localhost:8080/healthz || exit 1']
    interval: 10s
    timeout: 5s
    retries: 5
```

Add this alongside your existing services in `uigraph-deploy`'s `docker-compose.yml` — it'll automatically join the `uigraph` network already defined there (`networks.default.name: uigraph`), so no per-service `networks:` block is needed. This matches the conventions already used across `uigraph-deploy` (image tag pattern, `${VAR}` substitution for secrets, `/healthz` healthcheck).

## 6. Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | yes | — | Bot User OAuth token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | yes (Socket Mode) | — | App-level token with `connections:write` (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | yes (HTTP mode only) | — | Verifies inbound Events API requests |
| `SLACK_MODE` | no | `socket` | `socket` \| `http` |
| `PORT` | no (HTTP mode only) | `8080` | Listen port for the Events API webhook |
| `UIGRAPH_MCP_URL` | yes | — | Base URL of your `uigraph-mcp` instance |
| `UIGRAPH_SERVICE_TOKEN` | yes* | — | Default service-account token (single-org deployments) |
| `UIGRAPH_ORG_ID` | yes* | — | Org ID paired with `UIGRAPH_SERVICE_TOKEN` |
| `UIGRAPH_ORG_MAP_FILE` | no | — | Path to a channel/team → `{orgId, serviceToken}` mapping (multi-org; overrides the pair above) |
| `UIGRAPH_FRONTEND_URL` | no | — | Used to build "View in UiGraph" deep links in replies |
| `LLM_PROVIDER` | yes | — | `anthropic` \| `openai` \| `custom` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `LLM_API_KEY` | yes (matching provider) | — | LLM provider credential |
| `LLM_BASE_URL` | no | — | For `custom` OpenAI-compatible endpoints |
| `LLM_MODEL` | no | provider default | e.g. `claude-opus-4-8`, `claude-sonnet-5` |
| `LLM_MAX_TOOL_ITERATIONS` | no | `6` | Caps the agentic tool-calling loop |
| `LOG_LEVEL` | no | `info` | |

\* Required unless `UIGRAPH_ORG_MAP_FILE` is set.

## 7. Verify

Invite the bot to a test channel (`/invite @uigraph`) and `@mention` it with a question, e.g. `@uigraph what services depend on the billing database?`. You should see a threaded reply within a few seconds. If nothing happens, check the bot's logs first — a missing or invalid `UIGRAPH_SERVICE_TOKEN` and a missing `LLM_PROVIDER` key are the two most common startup failures.

## Multi-org setup

If you run multiple UiGraph organizations and want different Slack channels (or different workspaces) mapped to different orgs, use `UIGRAPH_ORG_MAP_FILE` instead of the single `UIGRAPH_SERVICE_TOKEN`/`UIGRAPH_ORG_ID` pair. Each org needs its own service-account token, minted exactly as in step 3, scoped to that org — a single token cannot be shared across orgs (see [ARCHITECTURE.md](ARCHITECTURE.md#org-resolution--why-its-one-token-per-org-not-one-token--a-header) for why).

```json
{
  "channels": {
    "C0123ABCDEF": { "orgId": "org_platform", "serviceToken": "uig_..." },
    "C0456GHIJKL": { "orgId": "org_payments", "serviceToken": "uig_..." }
  }
}
```

Channel IDs (not names) are the keys — find a channel's ID in Slack via **View channel details → About**. Any channel not listed falls back to the single-org pair if configured, or is rejected with a clear "no org configured for this channel" reply.
