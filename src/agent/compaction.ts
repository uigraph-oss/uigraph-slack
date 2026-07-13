import { SUMMARIZATION_SYSTEM_PROMPT } from '@/constants/summarization-prompt'
import { env } from '@/env'
import { logger } from '@/logger'
import { aiModel } from '@/provider/ai-sdk'
import type { webApi } from '@slack/bolt'
import { generateText, type ModelMessage } from 'ai'

type WebClient = webApi.WebClient

export const COMPACTION_FILENAME = 'compaction.md'
export const COMPACTION_TOKEN_BUDGET = 2000

export type SlackMessage = NonNullable<
  Awaited<ReturnType<WebClient['conversations']['replies']>>['messages']
>[number]

export type Checkpoint = {
  summaryText: string
  checkpointTs: string
  fileId: string | undefined
}

function isBotMessage(
  message: SlackMessage,
  botUserId: string | undefined
): boolean {
  return message.bot_id !== undefined || message.user === botUserId
}

export function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0
  for (const message of messages) {
    if (typeof message.content === 'string') {
      chars += message.content.length
      continue
    }
    for (const part of message.content) {
      if (part.type === 'text') {
        chars += part.text.length
        continue
      }
      chars += 2000
    }
  }
  return Math.ceil(chars / 4)
}

export async function findCheckpoint(
  slackMessages: SlackMessage[],
  botUserId: string | undefined
): Promise<Checkpoint | null> {
  for (let i = slackMessages.length - 1; i >= 0; i--) {
    const message = slackMessages[i]
    if (!isBotMessage(message, botUserId) || message.ts === undefined) {
      continue
    }

    const file = (message.files ?? []).find(
      (f) => f.title === COMPACTION_FILENAME || f.name === COMPACTION_FILENAME
    )
    if (file === undefined) {
      continue
    }

    const url = file.url_private_download ?? file.url_private
    if (url === undefined) {
      continue
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    })
    if (!response.ok) {
      logger
        .withTag('compaction')
        .error(`Failed to download checkpoint file: status ${response.status}`)
      return null
    }

    const summaryText = await response.text()
    return { summaryText, checkpointTs: message.ts, fileId: file.id }
  }

  return null
}

export async function summarize(
  previousSummary: string | null,
  droppedMessages: ModelMessage[]
): Promise<string> {
  const messages: ModelMessage[] = []
  if (previousSummary !== null) {
    messages.push({
      role: 'user',
      content: `[Previous summary]\n${previousSummary}`,
    })
  }
  messages.push(...droppedMessages)
  messages.push({
    role: 'user',
    content:
      'Update the running summary to incorporate the conversation above.',
  })

  const result = await generateText({
    model: aiModel,
    system: SUMMARIZATION_SYSTEM_PROMPT,
    messages,
  })

  return result.text
}

export async function writeCheckpoint(
  client: WebClient,
  channelId: string,
  threadTs: string,
  summaryText: string,
  previousFileId: string | undefined
): Promise<void> {
  await client.files.uploadV2({
    channel_id: channelId,
    thread_ts: threadTs,
    filename: COMPACTION_FILENAME,
    title: COMPACTION_FILENAME,
    content: summaryText,
  })

  if (previousFileId === undefined) {
    return
  }

  try {
    await client.files.delete({ file: previousFileId })
  } catch (error) {
    logger
      .withTag('compaction')
      .error('Failed to delete previous checkpoint file', error)
  }
}
