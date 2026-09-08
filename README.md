# uigraph-slack

[![license](https://img.shields.io/badge/license-BUSL--1.1-blue)](LICENSE)

Slack app for [UIGraph](https://github.com/uigraph-oss). Built with [Bolt for JavaScript](https://slack.dev/bolt-js/) and the [AI SDK](https://ai-sdk.dev/), it answers questions about your services and architecture directly in Slack by calling tools exposed over [uigraph-mcp](https://github.com/uigraph-oss/uigraph-mcp).

## Features

- **Mentions and DMs** — replies to `@mentions` in channels and direct messages, using thread history as conversation context
- **MCP tool calling** — connects to UiGraph's MCP server so answers are grounded in live service, diagram, and documentation data
- **Slack-native formatting** — converts model output to Slack `mrkdwn` (tables, code blocks) and uploads generated images/files as message attachments
- **Two deployment modes** — Socket Mode for a single self-hosted workspace, HTTP mode for multi-workspace installs backed by uigraph-api
- **Turn metadata** — records which tools were called on each posted message, attached as Slack message metadata for debugging

## Local development

The app runs in one of two modes, selected by the `UIGRAPH_ENTERPRISE` environment variable.

### Socket mode (single workspace)

The default mode. Good for self-hosting a bot into one Slack workspace using a bot token and app-level token from your Slack app config.

```bash
pnpm install
pnpm dev
```

Requires `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and `UIGRAPH_TOKEN` — see [Environment variables](#environment-variables).

### HTTP mode (multi-workspace)

Serves Slack's Events API over HTTP and resolves each team's credentials from uigraph-api's installation store, so one deployment can serve many Slack workspaces. Set `UIGRAPH_ENTERPRISE=true` and provide `SLACK_SIGNING_SECRET` and `UIGRAPH_ENTERPRISE_INTERNAL_TOKEN`.

```bash
UIGRAPH_ENTERPRISE=true pnpm dev
```

The app listens on `PORT` (default `3000`) with Bolt's default receiver, i.e. `POST /slack/events`.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `UIGRAPH_ENTERPRISE` | `false` | `true` selects HTTP mode; otherwise Socket mode |
| `SLACK_BOT_DEBUG_MODE` | `false` | Verbose Slack/logging output |
| `UIGRAPH_API_URL` | — | Base URL of uigraph-api (required) |
| `UIGRAPH_MCP_URL` | — | Base URL of the MCP server (required) |
| `AI_PROVIDER_NPM` | `@ai-sdk/openai-compatible` | AI SDK provider package |
| `AI_PROVIDER_API_URL` | — | Provider API base URL |
| `AI_PROVIDER_API_KEY` | — | Provider API key (required) |
| `AI_PROVIDER_MODEL` | — | Model id to use (required) |
| `AI_PROVIDER_OPTIONS` | — | Extra provider options, as a JSON object string |
| `LLM_MAX_STEP` | `100` | Max tool-call steps per turn |
| `LLM_MESSAGES_LIMIT` | `25` | Max thread messages sent as context |
| `LLM_ATTACHMENT_IMAGE` | `false` | Allow image attachments as model input |
| `LLM_ATTACHMENT_AUDIO` | `false` | Allow audio attachments as model input |
| `LLM_ATTACHMENT_VIDEO` | `false` | Allow video attachments as model input |

Socket mode only:

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-...`) from your Slack app |
| `SLACK_APP_TOKEN` | App-level token (`xapp-...`) with `connections:write` |
| `UIGRAPH_TOKEN` | Service-account token used to connect to the MCP server |

HTTP mode only:

| Variable | Description |
|---|---|
| `SLACK_SIGNING_SECRET` | Signing secret from your Slack app, used to verify requests |
| `UIGRAPH_ENTERPRISE_INTERNAL_TOKEN` | Internal token for reading per-team installations from uigraph-api |

## Testing

```bash
pnpm test
pnpm typecheck
pnpm lint
```

## License

This project is licensed under the [Business Source License 1.1](LICENSE) (BUSL-1.1).

- **Source available today** — you can read, modify, and redistribute the code under the terms of the license.
- **Non-production use** — free for development, testing, evaluation, and internal proof-of-concept.
- **Production use** — requires a commercial license from UIGraph. Production use means any use that supports the ongoing operation of your business or organization.
- **Future open source** — each version automatically converts to [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) four years after it is first published under BUSL.

BUSL is not an OSI-approved open source license during the initial term. For commercial licensing questions, open an issue or contact the maintainers.

