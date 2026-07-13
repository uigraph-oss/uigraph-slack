import { env } from '@/env'
import { logger } from '@/logger'
import type { SlackMessage } from '@/types'
import type { ModelMessage, UserContent } from 'ai'

export async function buildMessages(
  slackMessages: SlackMessage[],
  botUserId: string | undefined
): Promise<ModelMessage[]> {
  const messages: ModelMessage[] = []
  for (const message of slackMessages) {
    const text = (message.text ?? '').replace(/<@[^>]+>/g, '').trim()
    const isBot = message.bot_id !== undefined || message.user === botUserId

    if (isBot) {
      if (text === '') {
        continue
      }
      messages.push({ role: 'assistant', content: text })
      continue
    }

    const content: UserContent = []
    if (text !== '') {
      content.push({ type: 'text', text })
    }

    for (const file of message.files ?? []) {
      if (file.mimetype === undefined || !file.mimetype.startsWith('image/')) {
        continue
      }

      const url = file.url_private_download ?? file.url_private
      if (url === undefined) {
        continue
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (!response.ok || !contentType.startsWith('image/')) {
        logger
          .withTag('slack')
          .error(
            `Image download failed for ${file.name}: status ${response.status}, content-type ${contentType}`
          )
        continue
      }

      const data = new Uint8Array(await response.arrayBuffer())
      content.push({ type: 'file', data, mediaType: file.mimetype })
    }

    if (content.length === 0) {
      continue
    }
    messages.push({ role: 'user', content })
  }

  return messages
}
