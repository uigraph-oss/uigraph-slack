import type { webApi } from '@slack/bolt'

type WebClient = webApi.WebClient

export const THREAD_MESSAGE_WINDOW = 20

export type SlackMessage = NonNullable<
  Awaited<ReturnType<WebClient['conversations']['replies']>>['messages']
>[number]
