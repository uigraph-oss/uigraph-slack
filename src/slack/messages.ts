import { env } from '@/env'
import { logger } from '@/logger'
import { readToolOutputs } from '@/slack/metadata'
import { resolveUserName } from '@/slack/user'
import type { SlackMessage, TurnContext } from '@/types'
import type { AssistantContent, ModelMessage, UserContent } from 'ai'

export async function buildMessages(
  slackMessages: SlackMessage[],
  turn: TurnContext
): Promise<ModelMessage[]> {
  const { botUserId, client, teamId, botToken } = turn
  if (botToken === undefined) {
    throw new Error('Slack bot token is missing for this turn')
  }
  const allowedPrefixes: string[] = []
  if (env.LLM_ATTACHMENT_IMAGE) {
    allowedPrefixes.push('image/')
  }
  if (env.LLM_ATTACHMENT_AUDIO) {
    allowedPrefixes.push('audio/')
  }
  if (env.LLM_ATTACHMENT_VIDEO) {
    allowedPrefixes.push('video/')
  }

  const messages: ModelMessage[] = []
  for (const message of slackMessages) {
    const text = (message.text ?? '').replace(/<@[^>]+>/g, '').trim()
    const isBot = message.bot_id !== undefined || message.user === botUserId

    if (isBot) {
      const toolOutputs = readToolOutputs(message)
      if (toolOutputs !== undefined) {
        const content: AssistantContent = []
        if (text !== '') {
          content.push({ type: 'text', text })
        }
        content.push({
          type: 'text',
          text: `<tool_outputs>\n${toolOutputs.join('\n\n')}\n</tool_outputs>`,
        })
        messages.push({ role: 'assistant', content })
        continue
      }
      if (text === '') {
        continue
      }
      messages.push({ role: 'assistant', content: text })
      continue
    }

    const content: UserContent = []
    if (text !== '') {
      if (message.user) {
        const name = await resolveUserName(client, teamId, message.user)
        content.push({
          type: 'text',
          text: `<author>${name} <${message.user}></author>\n\n${text}`,
        })
      } else {
        content.push({ type: 'text', text })
      }
    }

    for (const file of message.files ?? []) {
      const mimetype = file.mimetype
      if (mimetype === undefined) {
        continue
      }
      const prefix = allowedPrefixes.find((p) => mimetype.startsWith(p))
      if (prefix === undefined) {
        continue
      }

      const url = file.url_private_download ?? file.url_private
      if (url === undefined) {
        continue
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${botToken}` },
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (!response.ok || !contentType.startsWith(prefix)) {
        logger
          .withTag('slack')
          .error(
            `Attachment download failed for ${file.name}: status ${response.status}, content-type ${contentType}`
          )
        continue
      }

      const data = new Uint8Array(await response.arrayBuffer())
      content.push({ type: 'file', data, mediaType: mimetype })
    }

    if (content.length === 0) {
      continue
    }
    messages.push({ role: 'user', content })
  }

  return messages
}
