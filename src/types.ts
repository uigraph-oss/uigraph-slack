import type { webApi } from '@slack/bolt'

export type TurnContext = {
  client: webApi.WebClient
  teamId: string | undefined
  botUserId: string | undefined
  botToken: string | undefined
  // The Slack user whose message is being answered, when answers are per user.
  askerId?: string
}

export type SlackMessage = NonNullable<
  Awaited<ReturnType<webApi.WebClient['conversations']['replies']>>['messages']
>[number] & {
  metadata?: {
    event_type?: string
    event_payload?: Record<string, unknown>
  }
}
