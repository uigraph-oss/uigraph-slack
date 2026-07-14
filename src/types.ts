import type { webApi } from '@slack/bolt'

export type SlackMessage = NonNullable<
  Awaited<ReturnType<webApi.WebClient['conversations']['replies']>>['messages']
>[number] & {
  metadata?: {
    event_type?: string
    event_payload?: Record<string, unknown>
  }
}
