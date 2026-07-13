import { App } from '@slack/bolt'
import type { ModelMessage, UserContent } from 'ai'
import { answer } from './agent/respond'
import { env } from './env'
import { logger } from './logger'
import { closeMcp, initMcp } from './mcp/client'

const app = new App({
  token: env.SLACK_BOT_TOKEN,
  appToken: env.SLACK_APP_TOKEN,
  socketMode: true,
})

app.event('app_mention', async ({ event, say, client, context }) => {
  const threadTs = event.thread_ts ?? event.ts

  logger.withTag('slack').info(`Mention from ${event.user} in ${event.channel}`)

  try {
    const thread = await client.conversations.replies({
      channel: event.channel,
      ts: threadTs,
    })

    const messages: ModelMessage[] = []
    for (const message of thread.messages ?? []) {
      const text = (message.text ?? '').replace(/<@[^>]+>/g, '').trim()
      const isBot =
        message.bot_id !== undefined || message.user === context.botUserId

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
        if (
          file.mimetype === undefined ||
          !file.mimetype.startsWith('image/')
        ) {
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

    const reply = await answer(messages)
    await say({ text: reply, thread_ts: threadTs })
    logger.withTag('slack').success(`Replied in thread ${threadTs}`)
  } catch (error) {
    await say({
      text: 'Sorry, I hit an error answering that.',
      thread_ts: threadTs,
    })

    logger.withTag('slack').error('Failed to answer mention', error)
  }
})

async function shutdown() {
  logger.info('Shutting down')
  await closeMcp()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

void (async () => {
  const tools = await initMcp()
  await app.start(process.env.PORT || 3000)
  logger.success(
    `⚡️ Bolt app is running with ${Object.keys(tools).length} MCP tools loaded!`
  )
})()
