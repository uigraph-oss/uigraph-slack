import { App } from '@slack/bolt'
import type { ModelMessage } from 'ai'
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
      if (text === '') {
        continue
      }

      const isBot =
        message.bot_id !== undefined || message.user === context.botUserId
      messages.push({ role: isBot ? 'assistant' : 'user', content: text })
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
