import { env } from '@/env'
import { logger } from '@/logger'
import { visibleTo } from '@/slack/asker'
import type {
  NewSessionMessage,
  SessionContent,
  SessionMessage,
} from '@/slack/session'
import type { ModelMessage, UserContent } from 'ai'
import type { Message, Thread } from 'chat'

export type VideoPlan = { request: string; outline: unknown }

export type ThreadState = { videoPlan?: VideoPlan }

// Input that came from a button, command or form rather than from a person's Slack message. It is
// saved under the bot's note of it.
export type ExtraInput = { text: string; slackMessageId: string }

export type Turn = {
  // The saved conversation as the asker may see it. It is replayed unchanged, so it is the
  // prompt prefix the provider has cached.
  history: ModelMessage[]
  // This turn's new input, saved with the model's reply.
  input: NewSessionMessage[]
}

function authored(message: Message, text: string) {
  return `<author>${message.author.fullName} <${message.author.userId}></author>\n\n${text}`
}

// Attachments are sent as base64 text so the saved message replays exactly as it was sent.
async function userContent(message: Message): Promise<UserContent> {
  const allowedPrefixes: string[] = []
  if (env.LLM_ATTACHMENT_IMAGE) allowedPrefixes.push('image/')
  if (env.LLM_ATTACHMENT_AUDIO) allowedPrefixes.push('audio/')
  if (env.LLM_ATTACHMENT_VIDEO) allowedPrefixes.push('video/')

  const content: UserContent = []
  const text = message.text.trim()
  if (text !== '') {
    content.push({ type: 'text', text: authored(message, text) })
  }
  for (const attachment of message.attachments) {
    const mimeType = attachment.mimeType
    if (mimeType === undefined) continue
    if (!allowedPrefixes.some((prefix) => mimeType.startsWith(prefix))) continue
    if (attachment.fetchData === undefined) {
      logger
        .withTag('slack')
        .error(`Attachment ${attachment.name} has no downloadable data`)
      continue
    }
    const data = (await attachment.fetchData()).toString('base64')
    content.push({ type: 'file', data, mediaType: mimeType })
  }
  return content
}

function isBot(message: Message) {
  return message.author.isMe || message.author.isBot === true
}

// A top-level DM has no thread: with the agent view off (the default) the adapter gives it an empty
// thread ts, and conversations.replies with ts="" answers thread_not_found. Its conversation is the
// DM's own recent messages, so those are read instead. Thread ids are "slack:CHANNEL:THREAD_TS".
export function fetchRecent(thread: Thread<ThreadState>, limit: number) {
  const [, channel = '', threadTs = ''] = thread.id.split(':')
  const fetchChannel = thread.adapter.fetchChannelMessages
  if (threadTs === '' && channel !== '' && fetchChannel !== undefined) {
    return fetchChannel.call(thread.adapter, `slack:${channel}`, { limit })
  }
  return thread.adapter.fetchMessages(thread.id, { limit })
}

// The first turn starts from the thread's recent messages, bot replies included. Later turns add
// the people's messages posted since the last saved one; the bot's replies are already saved.
// Slack message ids are timestamps of one fixed width, so they compare as text.
export async function buildTurn(
  thread: Thread<ThreadState>,
  askerId: string,
  saved: SessionMessage[],
  extra: ExtraInput | undefined
): Promise<Turn> {
  const fetched = await fetchRecent(thread, env.LLM_MESSAGES_LIMIT)
  const lastSaved = saved
    .filter((message) => message.slackMessageId !== undefined)
    .at(-1)?.slackMessageId

  const input: NewSessionMessage[] = []
  for (const message of fetched.messages) {
    if (message.id === extra?.slackMessageId) continue
    if (lastSaved !== undefined && message.id <= lastSaved) continue
    if (isBot(message)) {
      if (lastSaved !== undefined) continue
      const text = message.text.trim()
      if (text !== '') {
        input.push({
          content: { role: 'assistant', content: text },
          slackMessageId: message.id,
        })
      }
      continue
    }
    const content = await userContent(message)
    if (content.length > 0) {
      input.push({
        content: { role: 'user', content },
        slackMessageId: message.id,
      })
    }
  }
  if (extra !== undefined) {
    input.push({
      content: { role: 'user', content: extra.text },
      slackMessageId: extra.slackMessageId,
    })
  }
  return { history: visibleTo(saved, askerId), input }
}

const CLEARED_TOOL_RESULT = {
  type: 'text' as const,
  value:
    'Cleared to keep the conversation short. Call the tool again if you need this.',
}

// When the conversation outgrows LLM_CONTEXT_TOKENS, clears the tool results from before the
// latest turn. The prompt changes once, so the cache is rebuilt once, and later turns are cheaper.
// Returns the messages to save back, or none while the conversation fits.
export function compaction(saved: SessionMessage[]) {
  const measured = saved
    .filter((message) => message.inputTokens !== undefined)
    .at(-1)
  if (measured === undefined) return []
  const size = (measured.inputTokens ?? 0) + (measured.outputTokens ?? 0)
  if (size <= env.LLM_CONTEXT_TOKENS) return []

  const latestTurn = saved
    .filter((message) => message.content.role === 'user')
    .at(-1)?.seq
  if (latestTurn === undefined) return []
  const replaced: Array<{ seq: number; content: SessionContent }> = []
  for (const message of saved) {
    if (message.seq >= latestTurn) break
    const content = message.content
    if (content.role !== 'tool') continue
    if (
      content.content.every(
        (part) =>
          part.type !== 'tool-result' ||
          (part.output.type === 'text' &&
            part.output.value === CLEARED_TOOL_RESULT.value)
      )
    ) {
      continue
    }
    replaced.push({
      seq: message.seq,
      content: {
        ...content,
        content: content.content.map((part) =>
          part.type === 'tool-result'
            ? { ...part, output: CLEARED_TOOL_RESULT }
            : part
        ),
      },
    })
  }
  return replaced
}
