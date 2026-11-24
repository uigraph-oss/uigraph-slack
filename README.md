# uigraph-slack

[![license](https://img.shields.io/badge/license-BUSL--1.1-blue)](LICENSE)

Slack app for [UIGraph](https://github.com/uigraph-oss). Built with [Chat SDK](https://chat-sdk.dev/) and the [AI SDK](https://ai-sdk.dev/), it answers questions about your services and architecture directly in Slack by calling tools exposed over [uigraph-mcp](https://github.com/uigraph-oss/uigraph-mcp).

## Features

- **Mentions, follow-ups and DMs** — replies to `@mentions` and direct messages, using thread history as context. Once mentioned it follows the thread: while one person is talking to it, replies need no new mention; once others join, it waits for a mention
- **Live progress** — the answer streams in under a step list that shows each tool call as it runs
- **Native Slack output** — tables, charts, service cards with buttons, diagram images, pick-one menus, and videos uploaded as MP4s that play in Slack
- **Videos from Slack** — `/uigraph video` or a card's "Explain as a video" button opens a form; the bot posts a scene plan with "Make this video" and "Change it", then posts the video once it is rendered
- **MCP tool calling** — connects to UiGraph's MCP server so answers are grounded in live service, diagram, and documentation data
- **Two deployment modes** — Socket Mode for a single self-hosted workspace, HTTP mode for multi-workspace installs backed by uigraph-api
- **Thread conversations** — each thread’s conversation with the model (questions, replies, tool calls and results, and each call’s token usage) is saved and replayed exactly, so follow-ups reuse earlier results and the provider’s prompt cache keeps working. Tool results from another person’s turn are not replayed to you. Once a conversation passes `LLM_CONTEXT_TOKENS`, older tool results are cleared
- **Shared state** — with `UIGRAPH_ENTERPRISE_INTERNAL_TOKEN` set, followed threads, thread locks, thread memory and conversations live in uigraph-api (its internal `/internal/v1/slack-app/state` and `/internal/v1/slack-app/sessions` routes), so they survive restarts and are shared by every replica. Without it they are held in memory, are lost on restart, and the app must run as a single instance

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

The app listens on `PORT` (default `3000`). Point the Slack app's Event Subscriptions, Interactivity and the `/uigraph` slash command at `POST /slack/events`. `GET /healthz` answers `ok`.

#### Answering as each person (optional)

By default HTTP mode answers with one service account per workspace, so everyone in Slack sees the same data. Set `UIGRAPH_OAUTH_CLIENT_ID` to answer as the person who asked instead:

- The first time someone mentions the app, it sends them a private link to connect their UIGraph account. They sign in to UIGraph and approve; after that the app uses that person's own access (their role, in the organization the workspace is installed for) and nothing is answered for someone who has not connected.
- The app offers only tools that read or add. Tools that change or delete are left out, because other people's channel text can steer a turn.
- When a turn creates a video, a "Rendering" note with the watch link is posted first. Once the MP4 is rendered it is uploaded into the thread. Rendering needs a render worker on the UIGraph side; without one the bot gives up after a few minutes and points to the watch link.
- To set it up, register this app as an OAuth client of your uigraph-api (`POST /oauth/register`) with the redirect URI `<SLACK_APP_PUBLIC_URL>/uigraph/callback`, and set the variables below. Each Slack user connects once; a person can remove the approval under Connected applications in UIGraph.

## Environment variables

| Variable               | Default                     | Description                                                                                                      |
| ---------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `UIGRAPH_ENTERPRISE`   | `false`                     | `true` selects HTTP mode; otherwise Socket mode                                                                  |
| `SLACK_BOT_DEBUG_MODE` | `false`                     | Verbose Slack/logging output                                                                                     |
| `SLACK_AGENT_VIEW`     | `false`                     | `true` when the Slack app has the agent experience (`agent_view`) on: suggested prompts and agent threads in DMs |
| `UIGRAPH_FRONTEND_URL` | —                           | Where people open UIGraph; adds "Watch in UIGraph" buttons to videos                                             |
| `UIGRAPH_API_URL`      | —                           | Base URL of uigraph-api (required)                                                                               |
| `UIGRAPH_MCP_URL`      | —                           | Base URL of the MCP server (required)                                                                            |
| `AI_PROVIDER_NPM`      | `@ai-sdk/openai-compatible` | AI SDK provider package                                                                                          |
| `AI_PROVIDER_API_URL`  | —                           | Provider API base URL                                                                                            |
| `AI_PROVIDER_API_KEY`  | —                           | Provider API key (required)                                                                                      |
| `AI_PROVIDER_MODEL`    | —                           | Model id to use (required)                                                                                       |
| `AI_PROVIDER_OPTIONS`  | —                           | Extra provider options, as a JSON object string                                                                  |
| `LLM_MAX_STEP`         | `100`                       | Max tool-call steps per turn                                                                                     |
| `LLM_MESSAGES_LIMIT`   | `25`                        | Max recent thread messages read each turn for new input                                                          |
| `LLM_CONTEXT_TOKENS`   | `100000`                    | Conversation size after which older tool results are cleared                                                     |
| `LLM_ATTACHMENT_IMAGE` | `false`                     | Allow image attachments as model input                                                                           |
| `LLM_ATTACHMENT_AUDIO` | `false`                     | Allow audio attachments as model input                                                                           |
| `LLM_ATTACHMENT_VIDEO` | `false`                     | Allow video attachments as model input                                                                           |

Socket mode only:

| Variable                            | Description                                                         |
| ----------------------------------- | ------------------------------------------------------------------- |
| `SLACK_BOT_TOKEN`                   | Bot token (`xoxb-...`) from your Slack app                          |
| `SLACK_APP_TOKEN`                   | App-level token (`xapp-...`) with `connections:write`               |
| `UIGRAPH_TOKEN`                     | Service-account token used to connect to the MCP server             |
| `UIGRAPH_ENTERPRISE_INTERNAL_TOKEN` | Optional. Keeps the bot’s state in uigraph-api instead of in memory |

HTTP mode only:

| Variable                            | Description                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `SLACK_SIGNING_SECRET`              | Signing secret from your Slack app, used to verify requests                                          |
| `UIGRAPH_ENTERPRISE_INTERNAL_TOKEN` | Internal token for reading per-team installations from uigraph-api and keeping the bot’s state there |

HTTP mode, answering as each person (all required once `UIGRAPH_OAUTH_CLIENT_ID` is set):

| Variable                      | Description                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `UIGRAPH_OAUTH_CLIENT_ID`     | The OAuth client id registered for this app. Setting it turns the mode on             |
| `SLACK_APP_PUBLIC_URL`        | This app's public address; `/uigraph/connect` and `/uigraph/callback` are served here |
| `UIGRAPH_MCP_PUBLIC_URL`      | The MCP server's public address, which each approval is bound to                      |
| `UIGRAPH_FRONTEND_URL`        | Where people open UIGraph, used for watch links and the consent page                  |
| `UIGRAPH_OAUTH_AUTHORIZE_URL` | Optional. The consent page, when it is not `UIGRAPH_FRONTEND_URL` + `/oauth/consent`  |
| `SLACK_APP_STATE_SECRET`      | Optional, 16+ characters. Seals the connect link; defaults to `SLACK_SIGNING_SECRET`  |

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
