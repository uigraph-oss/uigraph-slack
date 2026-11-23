import type { ShownVideo } from '@/slack/video'
import type { App } from '@slack/bolt'
import type { ToolSet } from 'ai'

export type Runtime = {
  app: App
  // The tools for one turn. When answers are per user, slackUserId picks whose access they use,
  // and a user who has not connected a UIGraph account gets a NotConnectedError.
  getTools(teamId: string | undefined, slackUserId?: string): Promise<ToolSet>
  // Set when answers are per user: the link that connects a Slack user to UIGraph, what a
  // finished video looks like, and where people open UIGraph.
  connectUrl?(teamId: string, slackUserId: string): string
  showVideo?(
    teamId: string,
    slackUserId: string,
    docId: string
  ): Promise<ShownVideo>
  frontendUrl?: string
  close(): Promise<void>
}
