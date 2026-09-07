import type { webApi } from '@slack/bolt'
import { App } from '@slack/bolt'
import type { ModelMessage } from 'ai'
import { inspect } from 'node:util'
import { answer } from './agent/respond'
import { env } from './env'
import { logger } from './logger'
import { closeMcp, closeTeamMcp, initMcp } from './mcp/client'
import { formatForSlack } from './slack/format'
import { buildMessages } from './slack/messages'
import { buildTurnMetadata } from './slack/metadata'
import type { SlackMessage, TurnContext } from './types'
import {
  evictInstallation,
  getInstallation,
  removeInstallation,
} from './uigraph/installations'

function createApp(): App {
  if (env.mode === 'socket') {
    return new App({
      token: env.SLACK_BOT_TOKEN,
      appToken: env.SLACK_APP_TOKEN,
      socketMode: true,
    })
  }

  return new App({
    signingSecret: env.SLACK_SIGNING_SECRET,
    authorize: async ({ teamId }) => {
      if (teamId === undefined) {
        throw new Error('Slack event without team id is not supported')
      }
      const installation = await getInstallation(teamId)
      if (installation === undefined) {
        throw new Error(`Slack team ${teamId} is not connected to UiGraph`)
      }
      return {
        botToken: installation.botToken,
        botUserId: installation.botUserId,
        teamId: installation.teamId,
      }
    },
  })
}

const app = createApp()

function turnFromContext(
  client: webApi.WebClient,
  context: { teamId?: string; botUserId?: string; botToken?: string }
): TurnContext {
  return {
    client,
    teamId: context.teamId,
    botUserId: context.botUserId,
    botToken: context.botToken,
  }
}

async function answerThread(
  slackMessages: SlackMessage[],
  turn: TurnContext
): Promise<{ text: string; toolOutputs: string[] }> {
  const messages = await buildMessages(
    slackMessages.slice(-env.LLM_MESSAGES_LIMIT),
    turn
  )
  return answer(messages, turn.teamId)
}

async function forgetTeam(teamId: string | undefined): Promise<void> {
  if (teamId === undefined) {
    logger.withTag('slack').warn('Uninstall event without team id')
    return
  }
  logger.withTag('slack').info(`App removed from team ${teamId}`)
  evictInstallation(teamId)
  await closeTeamMcp(teamId)
  try {
    await removeInstallation(teamId)
  } catch (error) {
    logger
      .withTag('slack')
      .error(`Failed to remove installation for team ${teamId}`, error)
  }
}

if (env.mode === 'http') {
  app.event('app_uninstalled', async ({ context }) => {
    await forgetTeam(context.teamId)
  })

  app.event('tokens_revoked', async ({ event, context }) => {
    if ((event.tokens.bot ?? []).length === 0) {
      return
    }
    await forgetTeam(context.teamId)
  })
}

app.event('app_mention', async ({ event, say, client, context }) => {
  const threadTs = event.thread_ts ?? event.ts
  const turn = turnFromContext(client, context)

  logger.withTag('slack').info(`Mention from ${event.user} in ${event.channel}`)

  await client.reactions.add({
    channel: event.channel,
    timestamp: event.ts,
    name: 'eyes',
  })

  try {
    const thread = await client.conversations.replies({
      channel: event.channel,
      ts: threadTs,
      include_all_metadata: true,
    })

    const { text, toolOutputs } = await answerThread(
      thread.messages ?? [],
      turn
    )
    const formatted = formatForSlack(text)

    await client.reactions.remove({
      channel: event.channel,
      timestamp: event.ts,
      name: 'eyes',
    })

    const posted = await say({
      text: formatted.message,
      thread_ts: threadTs,
      metadata: buildTurnMetadata(toolOutputs),
    })
    logger
      .withTag('slack')
      .verbose(
        `Posted message metadata echo: ${inspect((posted as { message?: { metadata?: unknown } }).message?.metadata, { depth: null })}`
      )

    if (formatted.assets.length > 0) {
      logger
        .withTag('slack')
        .info(
          `Uploading ${formatted.assets.length} asset(s): ${inspect(formatted.assets)}`
        )
    }

    for (const url of formatted.assets) {
      const response = await fetch(url)
      if (!response.ok) {
        logger
          .withTag('slack')
          .error(`Asset download failed for ${url}: status ${response.status}`)
        continue
      }
      const filename = new URL(url).pathname.split('/').pop() || 'image'
      try {
        await client.files.uploadV2({
          channel_id: event.channel,
          thread_ts: threadTs,
          file: Buffer.from(await response.arrayBuffer()),
          filename,
        })
        logger
          .withTag('slack')
          .success(`Uploaded asset ${filename} from ${url}`)
      } catch (error) {
        logger.withTag('slack').error(`Asset upload failed for ${url}`, error)
      }
    }

    logger.withTag('slack').success(`Replied in thread ${threadTs}`)
  } catch (error) {
    await client.reactions
      .remove({
        channel: event.channel,
        timestamp: event.ts,
        name: 'eyes',
      })
      .catch(() => {})

    await say({
      text: 'Sorry, I hit an error answering that.',
      thread_ts: threadTs,
    })

    logger.withTag('slack').error(error)
    logger.withTag('slack').verbose(inspect(error, { depth: null }))
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
  const turn = turnFromContext(client, context)

  logger.withTag('slack').info(`DM from ${event.user} in ${event.channel}`)

  await client.reactions.add({
    channel: event.channel,
    timestamp: event.ts,
    name: 'eyes',
  })

  try {
    let messages: ModelMessage[]
    if (threadTs) {
      const before = await client.conversations.history({
        channel: event.channel,
        latest: threadTs,
        inclusive: true,
        limit: 20,
        include_all_metadata: true,
      })
      const thread = await client.conversations.replies({
        channel: event.channel,
        ts: threadTs,
        include_all_metadata: true,
      })
      const slackMessages = [
        ...(before.messages ?? []).reverse(),
        ...(thread.messages ?? []).slice(1),
      ]
      messages = await buildMessages(
        slackMessages.slice(-env.LLM_MESSAGES_LIMIT),
        turn
      )
    } else {
      const history = await client.conversations.history({
        channel: event.channel,
        limit: 20,
        include_all_metadata: true,
      })
      const slackMessages = (history.messages ?? [])
        .reverse()
        .slice(-env.LLM_MESSAGES_LIMIT)
      messages = await buildMessages(slackMessages, turn)
    }

    const { text, toolOutputs } = await answer(messages, turn.teamId)
    const formatted = formatForSlack(text)

    await client.reactions.remove({
      channel: event.channel,
      timestamp: event.ts,
      name: 'eyes',
    })

    const posted = await say({
      text: formatted.message,
      thread_ts: threadTs,
      metadata: buildTurnMetadata(toolOutputs),
    })
    logger
      .withTag('slack')
      .verbose(
        `Posted message metadata echo: ${inspect((posted as { message?: { metadata?: unknown } }).message?.metadata, { depth: null })}`
      )

    if (formatted.assets.length > 0) {
      logger
        .withTag('slack')
        .info(
          `Uploading ${formatted.assets.length} asset(s): ${inspect(formatted.assets)}`
        )
    }

    for (const url of formatted.assets) {
      const response = await fetch(url)
      if (!response.ok) {
        logger
          .withTag('slack')
          .error(`Asset download failed for ${url}: status ${response.status}`)
        continue
      }
      const file = Buffer.from(await response.arrayBuffer())
      const filename = new URL(url).pathname.split('/').pop() || 'image'
      try {
        if (threadTs) {
          await client.files.uploadV2({
            channel_id: event.channel,
            thread_ts: threadTs,
            file,
            filename,
          })
        } else {
          await client.files.uploadV2({
            channel_id: event.channel,
            file,
            filename,
          })
        }
        logger
          .withTag('slack')
          .success(`Uploaded asset ${filename} from ${url}`)
      } catch (error) {
        logger.withTag('slack').error(`Asset upload failed for ${url}`, error)
      }
    }

    logger.withTag('slack').success(`Replied in DM ${event.channel}`)
  } catch (error) {
    await client.reactions
      .remove({
        channel: event.channel,
        timestamp: event.ts,
        name: 'eyes',
      })
      .catch(() => {})

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
  if (env.mode === 'socket') {
    const tools = await initMcp()
    await app.start(process.env.PORT || 3000)
    logger.success(
      `⚡️ Bolt app is running in socket mode with ${Object.keys(tools).length} MCP tools loaded!`
    )
    return
  }

  await app.start(process.env.PORT || 3000)
  logger.success(
    `⚡️ Bolt app is running in HTTP mode on port ${process.env.PORT || 3000}`
  )
})()
