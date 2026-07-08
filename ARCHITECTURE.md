# Architecture

This document specifies how `uigraph-slack` works end-to-end. It's detailed enough to build the reference implementation from — every tool name, header, and env var here is verified against the current `uigraph-mcp` and `uigraph-api` source, not guessed.

## Overview

```
 Slack workspace              uigraph-slack (bolt-js)                 Your self-hosted UiGraph
┌──────────────┐   WSS    ┌───────────────────────────┐   HTTPS   ┌───────────────┐
│ app_mention /  │────────▶│  Slack event handler       │──────────▶│  uigraph-mcp   │
│ message.im     │◀────────│  (thread-scoped)           │◀──────────│  (MCP tools)   │
└──────────────┘          │            │                │           └───────┬───────┘
                          │            ▼                │                   │
                          │  reasoning loop (bounded      │                   ▼
                          │  tool-calling against the     │           uigraph-api
                          │  configured LLM)              │
                          │            │                │
                          │            ▼                │
                          │  LLM provider (BYO key)       │
                          └───────────────────────────┘
```

A single bolt-js process handles Slack events, holds one or more MCP client connections (one per configured UiGraph organization), and drives a bounded tool-calling loop against a pluggable LLM provider.

## Slack surfaces

**v1 supports two triggers, routed to the same handler:**

- **`app_mention`** — the primary surface. Invite the bot to a channel and `@mention` it with a question.
- **`message.im`** — direct messages to the bot, for private or exploratory questions.

Every reply is posted with `thread_ts` set to the triggering message's thread (or its own `ts` if it's the thread root), so a busy channel doesn't get flooded and follow-up questions stay coherent. A short-term, in-memory buffer keyed by `thread_ts` (TTL ~30 minutes, capped at the last ~10 turns) gives multi-turn context within a thread without any separate "start a session" step. If the bot runs multiple replicas for HA, this buffer should move to Redis (already part of a `uigraph-deploy` stack) — not required for a single-replica v1 deployment.

**Deliberately not supported in v1:**

- **Passive listening** (responding to channel messages without a mention). Rejected on purpose: it requires the broadest Slack read scopes, generates an LLM call on every message in the channel, and has no clean "is this for me" signal. This is a cost and security decision, not an oversight.
- **A `/uigraph` slash command.** Slash commands suit parameterized, deterministic actions (e.g. `/uigraph diagram checkout-service` calling `get_diagram` directly, skipping the LLM entirely) rather than open-ended natural-language Q&A. Documented here as a natural v1.1 extension once the reasoning loop is proven, not part of the v1 spec.

## Transport: Socket Mode vs HTTP mode

**Socket Mode is the default and the only mode documented in depth here.** The bot opens an outbound WebSocket to Slack using `SLACK_APP_TOKEN` (`xapp-...`, scope `connections:write`) and `SLACK_BOT_TOKEN` (`xoxb-...`). No inbound port, no public URL, and no signing-secret verification is needed — this is the reason Socket Mode is the right default for a self-hosted product: customers don't have to open ingress just to run a Slack bot.

```ts
new App({ token: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN, socketMode: true })
```

**HTTP/Events API mode** exists in bolt-js as an alternative (`socketMode: false`, `signingSecret: SLACK_SIGNING_SECRET`, bound to `PORT`), toggled via `SLACK_MODE=http`. This is only relevant if UiGraph later pursues Slack App Directory distribution, which additionally requires a public HTTPS Request URL and a multi-workspace OAuth install flow — a materially different distribution and multi-tenancy model than the self-hosted case this document specs. Not a near-term goal; noted here only so the config surface has room for it later.

## MCP integration

### Client setup

The bot holds one `StreamableHTTPClientTransport` (from `@modelcontextprotocol/sdk`) per configured UiGraph organization, pointed at `UIGRAPH_MCP_URL`. Every request sends:

- `Authorization: Bearer <uig_... service-account token>`
- `X-UIGraph-Org-Id: <org id>`

This matches `uigraph-mcp`'s actual auth model: the MCP server does not validate tokens itself — it forwards the bearer token as-is to `uigraph-api`, and resolves the org for each tool call from either a `org_id` tool argument or the `X-UIGraph-Org-Id` header (`internal/tools/helpers.go:orgID`), tool argument taking precedence.

### Org resolution — why it's one token per org, not one token + a header

A UiGraph service account is **bound to a single organization at creation** (`ServiceAccount.OrgID` in `uigraph-api`, set once and never reassigned). This means a single service-account token cannot be pointed at different orgs by changing a header — the header is only meaningful for human, session-derived tokens that can belong to multiple orgs, not for service accounts. Concretely:

- **Single-org deployment (the common case):** one Slack workspace ↔ one UiGraph organization ↔ one service-account token. Configured via `UIGRAPH_SERVICE_TOKEN` + `UIGRAPH_ORG_ID`.
- **Multi-org deployment:** requires **N distinct (token, orgId) pairs**, selected by a Slack channel (or team, for multi-workspace installs) → org mapping, configured via `UIGRAPH_ORG_MAP_FILE`. There is no way to share one token across orgs — this is enforced at `uigraph-api`, not something the bot can work around.

On startup, the bot should call `GET {UIGRAPH_MCP_URL}/auth/me` with each configured token as a self-check — this endpoint resolves identity/orgs for any bearer token (human or service-account) and is the fastest way to catch a copy-pasted or mismatched token before the bot starts serving traffic.

### Tool inventory

`uigraph-mcp` exposes a fixed set of 13 tools and no MCP resources or prompts. The bot lists tools once per org-connection at startup (they don't change at runtime) and maps their JSON Schema directly to the configured LLM's tool-call format (MCP and Anthropic's tool schemas are both JSON Schema, so this is close to a direct pass-through):

| Tool | Purpose |
|---|---|
| `get_service_context` | Rich single-call context for a service — catalog entry, API specs, DB schemas, diagrams. Usually the first and often the only call needed. |
| `list_services` | List services in an organization |
| `get_service` | Get a single service by ID or slug |
| `list_api_groups` | List API groups for a service |
| `get_api_spec` | Get the OpenAPI/GraphQL/gRPC spec for an API group |
| `list_endpoints` | List endpoints in an API group |
| `list_folders` | List folder hierarchy |
| `list_diagrams` | List diagrams in a folder |
| `get_diagram` | Get diagram content and metadata |
| `list_maps` | List system maps |
| `get_map` | Get map frames and focal points |
| `list_service_dbs` | List database schemas attached to a service |
| `get_db_schema` | Get a database schema definition |

## Reasoning loop

1. Slack event arrives → strip the mention → resolve `(orgId, mcpClient)` for the channel (single-org config, or a lookup in the channel→org map) → load/append the thread's short-term memory buffer.
2. Send the conversation + tool list to the configured LLM.
3. On a tool-use response: call the corresponding `uigraph-mcp` tool via the MCP client, append the result as a tool-result message, and loop back to step 2. Bounded by `LLM_MAX_TOOL_ITERATIONS` (default 6) to prevent runaway loops.
4. On a final (non-tool-use) response: format as a Slack reply and post it threaded.

A plain, manually-written `while` loop bounded by an iteration cap is the documented approach — not a framework-provided agent runner — because the tool surface is small and fixed (13 tools, known in advance), and a manual loop is easier to audit and reason about for a security-sensitive integration than an opaque agent abstraction.

**`org_id` is never exposed to the LLM as a parameter it can set.** The bot injects the org-scoping header/argument itself; the model only ever sees tool names and their non-org parameters. This removes any path by which a model could be prompted (accidentally or adversarially) into requesting data for the wrong organization.

### Response formatting

- Text answers become a Slack Block Kit `section` block.
- References to a specific diagram, service, or map include a `context`/link block deep-linking back to `UIGRAPH_FRONTEND_URL` ("View in UiGraph") rather than trying to render the object inline.
- Large tool results (full OpenAPI specs, full DB schemas) are summarized before reaching Slack — Slack's block text limit (~3,000 chars) means raw JSON dumps are truncated ungracefully if not handled explicitly. Summarize and link out instead.
- `max_tokens` for the LLM call should be bounded conservatively (roughly 2,000–4,000) for chat-shaped replies. No token-level streaming to Slack in v1 — Slack has no equivalent UX primitive, and a `chat.update`-based "typing" simulation is a nice-to-have, not part of this spec.

## LLM provider abstraction

Self-hosted UiGraph customers are, by definition, customers who care where their architecture data goes — and this bot is the first component in the stack whose entire job is to send that data to a third party (an LLM API) by design. This must be a first-class, visible configuration choice, not a buried default:

- `LLM_PROVIDER` — `anthropic` | `openai` | `custom`, behind a thin internal interface (`generate(messages, tools) → { toolCalls | text }`) so swapping providers never touches the Slack/MCP glue code.
- Provider-specific credentials: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `LLM_BASE_URL` + `LLM_API_KEY` for a `custom` OpenAI-compatible endpoint (e.g. a regional or self-hosted gateway for data-residency-sensitive deployments).
- `LLM_MODEL` — free-form, provider-specific, never a dated snapshot ID pinned in code. For the Anthropic path: `claude-opus-4-8` is the quality-first default; `claude-sonnet-5` is the explicit, documented recommendation for cost/latency-conscious deployments, since a Slack bot is a high-volume, short-conversational-turn workload where Sonnet-tier models are typically the better default in practice.
- **The bot refuses to start without a provider configured.** There is no silent default LLM — the operator must explicitly choose one, which is the point at which they should also be thinking about where their data is going.

## Config reference

The canonical environment variable table lives in [SETUP.md](SETUP.md#environment-variables) — see there for the full list with defaults and required/optional status.

## Security

See [SECURITY.md](SECURITY.md) for the full threat model, Slack/UiGraph scope rationale, secret handling, and data-egress guidance.

## Non-goals / future extensions

Explicitly out of scope for this spec, to be revisited later rather than assumed:

- **Per-user identity passthrough.** v1 always acts as a single shared service-account identity per org — everyone in a channel gets the same UiGraph-permission view through the bot. A future mode could let each Slack user link their own UiGraph account (reusing `uigraph-mcp`'s existing browser login broker: `/auth/login` → frontend `/authorize` → `/auth/callback`) so the bot acts as them and respects their individual RBAC. This is a real architectural fork, not an incremental change, and is deliberately not specified here.
- **`/uigraph` slash command** for deterministic, non-LLM lookups.
- **Slack App Directory / multi-workspace distribution**, which requires HTTP/Events API mode, a public Request URL, and per-workspace OAuth install and token storage.
- **Streaming replies** via `chat.update`.
