import { answer } from '@/agent/respond'
import { env } from '@/env'
import { logger } from '@/logger'
import type { Runtime } from '@/runtime'
import { formatForSlack } from '@/slack/format'
import { buildMessages } from '@/slack/messages'
import { buildTurnMetadata } from '@/slack/metadata'
import { createdVideoIds, uploadWhenRendered, watchUrl } from '@/slack/video'
import type { TurnContext } from '@/types'
import { NotConnectedError } from '@/uigraph/user-links'
import type { webApi } from '@slack/bolt'
import type { ModelMessage } from 'ai'
import { inspect } from 'node:util'

function turnFromContext(
  client: webApi.WebClient,
  context: { teamId?: string; botUserId?: string; botToken?: string },
  askerId?: string
): TurnContext {
  return {
    client,
    teamId: context.teamId,
    botUserId: context.botUserId,
    botToken: context.botToken,
    askerId,
  }
}

// A Slack user who has not connected a UIGraph account gets a link to do it, and nothing else.
// In a channel it is shown only to them.
async function promptToConnect(
  runtime: Runtime,
  client: webApi.WebClient,
  where: {
    teamId: string | undefined
    channel: string
    user: string
    threadTs: string | undefined
    direct: boolean
  }
): Promise<void> {
  const url = where.teamId
    ? runtime.connectUrl?.(where.teamId, where.user)
    : undefined
  const text =
    url === undefined
      ? 'Sorry, I could not start connecting your UIGraph account.'
      : `Connect your UIGraph account first: <${url}|Connect UIGraph>. It takes a moment, and after that I answer with your own access.`
  if (where.direct) {
    await client.chat.postMessage({
      channel: where.channel,
      thread_ts: where.threadTs,
      text,
    })
    return
  }
  await client.chat.postEphemeral({
    channel: where.channel,
    user: where.user,
    thread_ts: where.threadTs,
    text,
  })
}

// A video the turn created: the watch link goes out now if the answer did not already carry it,
// and the MP4 follows into the thread once it is rendered.
async function deliverVideos(
  runtime: Runtime,
  client: webApi.WebClient,
  turn: {
    teamId: string | undefined
    channel: string
    user: string
    threadTs: string | undefined
    answer: string
    toolOutputs: string[]
  }
): Promise<void> {
  const { teamId, user } = turn
  if (!runtime.showVideo || !runtime.frontendUrl || !teamId) {
    return
  }
  const { showVideo, frontendUrl } = runtime
  for (const docId of createdVideoIds(turn.toolOutputs)) {
    if (!turn.answer.includes(docId)) {
      await client.chat.postMessage({
        channel: turn.channel,
        thread_ts: turn.threadTs,
        text: `Watch it in UIGraph: ${watchUrl(frontendUrl, docId)}`,
      })
    }
    void uploadWhenRendered({
      files: client.files,
      channel: turn.channel,
      threadTs: turn.threadTs,
      docId,
      show: (id) => showVideo(teamId, user, id),
      log: (message) => logger.withTag('slack').warn(message),
    }).then((result) =>
      logger.withTag('slack').info(`Video ${docId} follow-up: ${result}`)
    )
  }
}

export function registerHandlers(runtime: Runtime): void {
  const { app, getTools } = runtime
  app.event('app_mention', async ({ event, say, client, context }) => {
    const threadTs = event.thread_ts ?? event.ts
    const turn = turnFromContext(client, context, event.user)

    logger
      .withTag('slack')
      .info(`Mention from ${event.user} in ${event.channel}`)

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

      const messages = await buildMessages(
        (thread.messages ?? []).slice(-env.LLM_MESSAGES_LIMIT),
        turn
      )
      const { text, toolOutputs } = await answer(
        messages,
        await getTools(turn.teamId, event.user)
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
        metadata: buildTurnMetadata(toolOutputs, event.user),
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
            .error(
              `Asset download failed for ${url}: status ${response.status}`
            )
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

      if (event.user !== undefined) {
        await deliverVideos(runtime, client, {
          teamId: turn.teamId,
          channel: event.channel,
          user: event.user,
          threadTs,
          answer: text,
          toolOutputs,
        })
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

      if (error instanceof NotConnectedError && event.user !== undefined) {
        await promptToConnect(runtime, client, {
          teamId: turn.teamId,
          channel: event.channel,
          user: event.user,
          threadTs,
          direct: false,
        })
        return
      }

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
    const turn = turnFromContext(client, context, event.user)

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

      const { text, toolOutputs } = await answer(
        messages,
        await getTools(turn.teamId, event.user)
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
        metadata: buildTurnMetadata(toolOutputs, event.user),
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
            .error(
              `Asset download failed for ${url}: status ${response.status}`
            )
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

      await deliverVideos(runtime, client, {
        teamId: turn.teamId,
        channel: event.channel,
        user: event.user,
        threadTs,
        answer: text,
        toolOutputs,
      })

      logger.withTag('slack').success(`Replied in DM ${event.channel}`)
    } catch (error) {
      await client.reactions
        .remove({
          channel: event.channel,
          timestamp: event.ts,
          name: 'eyes',
        })
        .catch(() => {})

      if (error instanceof NotConnectedError) {
        await promptToConnect(runtime, client, {
          teamId: turn.teamId,
          channel: event.channel,
          user: event.user,
          threadTs,
          direct: true,
        })
        return
      }

      await say({
        text: 'Sorry, I hit an error answering that.',
        thread_ts: threadTs,
      })

      logger.withTag('slack').error('Failed to answer DM', error)
    }
  })
}
