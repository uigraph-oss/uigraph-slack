import { App } from '@slack/bolt'
import { slackifyMarkdown } from 'slackify-markdown'
import { answer } from './agent/respond'
import { env } from './env'
import { logger } from './logger'
import { closeMcp, initMcp } from './mcp/client'
import { buildMessages } from './slack/messages'
import type { SlackMessage } from './types'

const app = new App({
  token: env.SLACK_BOT_TOKEN,
  appToken: env.SLACK_APP_TOKEN,
  socketMode: true,
})

async function answerThread(
  slackMessages: SlackMessage[],
  botUserId: string | undefined
): Promise<string> {
  const messages = await buildMessages(
    slackMessages.slice(-env.LLM_MESSAGES_LIMIT),
    botUserId
  )
  return answer(messages)
}

app.event('app_mention', async ({ event, say, client, context }) => {
  const threadTs = event.thread_ts ?? event.ts

  logger.withTag('slack').info(`Mention from ${event.user} in ${event.channel}`)

  try {
    const thread = await client.conversations.replies({
      channel: event.channel,
      ts: threadTs,
    })

    const reply = await answerThread(thread.messages ?? [], context.botUserId)
    await say({ text: slackifyMarkdown(reply), thread_ts: threadTs })
    logger.withTag('slack').success(`Replied in thread ${threadTs}`)
  } catch (error) {
    await say({
      text: 'Sorry, I hit an error answering that.',
      thread_ts: threadTs,
    })

    logger.withTag('slack').error('Failed to answer mention', error)
  }
})

app.event('message', async ({ event, say, client, context }) => {
  if (!('channel_type' in event) || event.channel_type !== 'im') {
    return
  }
  if (event.subtype !== undefined && event.subtype !== 'file_share') {
    return
  }
  if ('bot_id' in event && event.bot_id !== undefined) {
    return
  }
  if (!('user' in event) || event.user === undefined) {
    return
  }
  if (event.user === context.botUserId) {
    return
  }

  const threadTs = event.thread_ts

  logger.withTag('slack').info(`DM from ${event.user} in ${event.channel}`)

  try {
    let reply: string
    if (threadTs) {
      const before = await client.conversations.history({
        channel: event.channel,
        latest: threadTs,
        inclusive: true,
        limit: 20,
      })
      const thread = await client.conversations.replies({
        channel: event.channel,
        ts: threadTs,
      })
      const slackMessages = [
        ...(before.messages ?? []).reverse(),
        ...(thread.messages ?? []).slice(1),
      ]

      reply = await answerThread(slackMessages, context.botUserId)
    } else {
      const history = await client.conversations.history({
        channel: event.channel,
        limit: 20,
      })
      const slackMessages = (history.messages ?? [])
        .reverse()
        .slice(-env.LLM_MESSAGES_LIMIT)
      const messages = await buildMessages(slackMessages, context.botUserId)
      reply = await answer(messages)
    }

    await say({ text: slackifyMarkdown(reply), thread_ts: threadTs })
    logger.withTag('slack').success(`Replied in DM ${event.channel}`)
  } catch (error) {
    await say({
      text: 'Sorry, I hit an error answering that.',
      thread_ts: threadTs,
    })

    logger.withTag('slack').error('Failed to answer DM', error)
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
