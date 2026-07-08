# Security

This document covers the security model of the `uigraph-slack` bot process itself — the data it touches, the credentials it holds, and the failure modes to guard against. It is not a general UiGraph security policy; for that, see the core [uigraph-api](https://github.com/uigraph-oss/uigraph-api) repo.

## Data flow

```
Slack message ──▶ uigraph-slack ──▶ uigraph-mcp ──▶ uigraph-api ──▶ postgres
                        │
                        └────────▶ LLM provider (Anthropic / OpenAI / custom)
```

Two categories of data leave the customer's own infrastructure by design:

1. **Slack message content** (the question, and any thread context) flows into the bot process.
2. **Architecture data returned by `uigraph-mcp`** (service metadata, API specs, DB schemas, diagram/map content, docs) plus the Slack question flow to whichever LLM provider is configured, as part of the tool-calling reasoning loop.

Neither of these is optional in the current design — answering a question requires sending both the question and the retrieved architecture context to the LLM. This is why the LLM provider is BYO-key rather than a bundled default: it's the one place in this stack where customer architecture data is sent to a third party, and self-hosted customers are exactly the customers most likely to care where that is.

## Slack OAuth scopes — least privilege

The app manifest in [SETUP.md](SETUP.md#1-create-the-slack-app) requests exactly:

| Scope | Why |
|---|---|
| `app_mentions:read` | See messages that `@mention` the bot |
| `chat:write` | Post replies |
| `im:read` | Receive DMs sent to the bot |
| `im:history` | Read DM message content |

Deliberately **not** requested: `channels:history`, `groups:history`, or any other blanket channel-read scope. The bot only ever needs the single message that triggered an event (delivered directly in the event payload), never a general ability to read channel history. If a future version adds passive listening or channel-wide context, that would need to be a conscious, separately reviewed scope addition — not something granted upfront "just in case."

## UiGraph scopes — least privilege

The service account created in [SETUP.md](SETUP.md#3-mint-a-uigraph-mcp-service-account-token) should hold exactly `services:read`, `diagrams:read`, `maps:read`, `docs:read`, `folders:read` — read-only, and only the resources the 13 `uigraph-mcp` tools actually touch. No `*:write` scopes, no `members:*`/`teams:*`/`serviceaccounts:*` scopes: the bot never needs to modify data or manage org membership.

## Secrets

`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `UIGRAPH_SERVICE_TOKEN` (and any tokens in `UIGRAPH_ORG_MAP_FILE`), and LLM provider keys are all secrets. Inject them via environment variables (or Docker secrets / an external secrets manager in production) — never commit them to a config file or image layer. This matches how `uigraph-deploy` already treats `UIGRAPH_SECRET_KEY` and storage credentials.

A leaked `UIGRAPH_SERVICE_TOKEN` grants read access to everything in scope for that org (service catalog, diagrams, maps, schemas, docs) to whoever holds it — treat it with the same care as a database credential, and revoke and rotate it immediately if exposed (service-account tokens can be individually revoked without deleting the service account itself).

## Multi-tenant org isolation

As detailed in [ARCHITECTURE.md](ARCHITECTURE.md#org-resolution--why-its-one-token-per-org-not-one-token--a-header), a UiGraph service-account token is bound to exactly one organization. In a multi-org deployment, **the Slack channel → org mapping (`UIGRAPH_ORG_MAP_FILE`) is the trust boundary** between tenants. The primary self-hosting misconfiguration risk here is a stale or incorrect mapping — e.g. a channel reassigned to a different team without updating the map — which would silently serve one organization's architecture data into a channel that shouldn't see it. Review this mapping whenever channels, teams, or orgs change, the same way you'd review any other access-control list.

The bot also never lets the LLM set `org_id` as a tool parameter (it's injected server-side from the resolved channel mapping) — this removes any path by which a prompt, malicious or accidental, could cause a cross-tenant data request.

## LLM data egress

Restated plainly: architecture data and Slack questions are sent to whichever `LLM_PROVIDER` is configured, on every question the bot answers. The bot will not start without a provider configured — there is no silent default. For deployments with strict data-residency requirements, point `LLM_PROVIDER=custom` at a private or regional OpenAI-compatible gateway rather than a public provider endpoint.

## Rate limiting and abuse

Bound the reasoning loop per channel/thread (`LLM_MAX_TOOL_ITERATIONS`, default 6) to prevent a single conversation from looping indefinitely against either the LLM provider or `uigraph-mcp`'s upstream (`uigraph-api`). Consider an additional per-user or per-channel request rate limit in production to prevent one chatty channel from exhausting LLM provider quota or `uigraph-api` capacity that other tenants depend on.

## Reporting a vulnerability

If you find a security issue in this repo, please do not open a public GitHub issue. Instead, report it privately via [GitHub Security Advisories](https://github.com/uigraph-oss/uigraph-slack/security/advisories/new) for this repository.
