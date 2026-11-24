import type { McpConnection } from '@/mcp/client'
import type { SlackAdapterConfig } from '@chat-adapter/slack'

export type Runtime = {
  // How the Slack adapter connects: one workspace over Socket Mode, or many over HTTP.
  slack: SlackAdapterConfig
  // The MCP connection for one turn. teamId is the Slack workspace the event came from (unset in
  // socket mode). When answers are per user, slackUserId picks whose access is used, and a user
  // who has not connected a UIGraph account gets a NotConnectedError.
  connection(
    teamId: string | undefined,
    slackUserId: string
  ): Promise<McpConnection>
  // Set when answers are per user: the link that connects a Slack user to UIGraph.
  connectUrl?(teamId: string, slackUserId: string): string
  // Set in HTTP mode: drops a workspace that removed the app.
  forgetTeam?(teamId: string): Promise<void>
  // Set in HTTP mode: the pages served next to Slack's events, such as /healthz.
  page?(request: Request): Promise<Response>
  close(): Promise<void>
}
