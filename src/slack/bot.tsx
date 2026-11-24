import { answer, replyMessages } from '@/agent/respond'
import { env } from '@/env'
import { logger } from '@/logger'
import type { McpConnection } from '@/mcp/client'
import type { Runtime } from '@/runtime'
import {
  ASK_ACTION_IDS,
  asCard,
  displayTools,
  type TurnDisplay,
} from '@/slack/display'
import {
  buildTurn,
  compaction,
  type ExtraInput,
  type ThreadState,
} from '@/slack/history'
import { createApiSessions, createMemorySessions } from '@/slack/session'
import { createApiState } from '@/slack/state'
import {
  createdVideoIds,
  showVideo,
  uploadWhenRendered,
  watchUrl,
  type RenderedVideo,
} from '@/slack/video'
import { NotConnectedError } from '@/uigraph/user-links'
import { SlackAdapter } from '@chat-adapter/slack'
import { createMemoryState } from '@chat-adapter/state-memory'
import { tool, type StepResult, type TextStreamPart, type ToolSet } from 'ai'
import {
  Actions,
  Button,
  Card,
  CardText,
  Chat,
  Field,
  Fields,
  LinkButton,
  Modal,
  RadioSelect,
  SelectOption,
  StreamingPlan,
  Table,
  TextInput,
  type PostableMessage,
  type StreamChunk,
  type Thread,
} from 'chat'
import { inspect } from 'node:util'
import { z } from 'zod'

// Exposes the Slack workspace of the event being handled, which the adapter keeps per request.
class WorkspaceSlackAdapter extends SlackAdapter {
  get installationId(): string | undefined {
    return this.requestContext.getStore()?.installationId
  }
}

type Request = {
  askerId: string
  extra?: ExtraInput
}

const log = logger.withTag('slack')

function taskTitle(toolName: string) {
  return toolName
    .replaceAll('_', ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase())
}

function mcpText(output: unknown): string[] {
  const result = output as {
    content?: Array<{ type?: string; text?: string }>
    isError?: boolean
  }
  if (result.isError === true || !Array.isArray(result.content)) return []
  return result.content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
}

// Turns tool calls into the live step list above the answer, and keeps the UIGraph tool results.
async function* withTasks(
  parts: AsyncIterable<TextStreamPart<ToolSet>>,
  turn: TurnDisplay
) {
  for await (const part of parts) {
    if (part.type === 'tool-call') {
      log.debug(
        `Tool ${part.toolName} input: ${inspect(part.input, { depth: null })}`
      )
      yield {
        type: 'task_update',
        id: part.toolCallId,
        title: taskTitle(part.toolName),
        status: 'in_progress',
      } satisfies StreamChunk
      continue
    }
    if (part.type === 'tool-result') {
      log.verbose(
        `Tool ${part.toolName} output: ${inspect(part.output, { depth: null })}`
      )
      turn.toolOutputs.push(...mcpText(part.output))
      yield {
        type: 'task_update',
        id: part.toolCallId,
        title: taskTitle(part.toolName),
        status: 'complete',
      } satisfies StreamChunk
      continue
    }
    if (part.type === 'tool-error') {
      log.error(`Tool ${part.toolName} failed`, part.error)
      yield {
        type: 'task_update',
        id: part.toolCallId,
        title: taskTitle(part.toolName),
        status: 'error',
      } satisfies StreamChunk
      continue
    }
    if (part.type === 'error') {
      throw part.error
    }
    yield part
  }
}

function videoMessage(video: RenderedVideo, docId: string): PostableMessage {
  return {
    card: asCard(
      <Card title={video.title}>
        {env.UIGRAPH_FRONTEND_URL && (
          <Actions>
            <LinkButton url={watchUrl(env.UIGRAPH_FRONTEND_URL, docId)}>
              Watch in UIGraph
            </LinkButton>
          </Actions>
        )}
      </Card>
    ),
    fallbackText: `Video: ${video.title}`,
    files: [
      { data: video.data, filename: video.filename, mimeType: 'video/mp4' },
    ],
  }
}

function inBackground(label: string, work: () => Promise<void>) {
  work().catch((error: unknown) => log.error(`${label} failed`, error))
}

const SUGGESTED_PROMPTS = [
  { title: 'Our services', message: 'What services do we have?' },
  {
    title: 'A diagram',
    message: 'Show me the architecture diagram of our main service',
  },
  {
    title: 'Make a video',
    message:
      'Make a 1-minute video about how a request flows through our services',
  },
]

function createStorage() {
  const token = env.UIGRAPH_ENTERPRISE_INTERNAL_TOKEN
  if (token === undefined) {
    log.warn(
      'UIGRAPH_ENTERPRISE_INTERNAL_TOKEN is not set: followed threads and conversations stay in memory and are lost on restart'
    )
    return { state: createMemoryState(), sessions: createMemorySessions() }
  }
  log.info('Keeping followed threads and conversations in UIGraph')
  return {
    state: createApiState(env.UIGRAPH_API_URL, token),
    sessions: createApiSessions(env.UIGRAPH_API_URL, token),
  }
}

export function createBot(runtime: Runtime) {
  const slack = new WorkspaceSlackAdapter({
    ...runtime.slack,
    userName: 'uigraph',
    agentView: env.SLACK_AGENT_VIEW,
    feedbackButtons: true,
    suggestedPrompts: { prompts: SUGGESTED_PROMPTS },
  })

  const storage = createStorage()
  const sessions = storage.sessions
  const bot = new Chat<{ slack: WorkspaceSlackAdapter }, ThreadState>({
    userName: 'uigraph',
    logger: env.SLACK_BOT_DEBUG_MODE ? 'debug' : 'info',
    adapters: { slack },
    state: storage.state,
  })

  function connectionFor(teamId: string | undefined, askerId: string) {
    return runtime.connection(teamId, askerId)
  }

  // A Slack user who has not connected a UIGraph account gets a link to do it, and nothing else.
  // In a channel it is shown only to them.
  async function promptToConnect(
    thread: Thread<ThreadState>,
    teamId: string | undefined,
    askerId: string
  ) {
    const url =
      teamId === undefined ? undefined : runtime.connectUrl?.(teamId, askerId)
    const markdown =
      url === undefined
        ? 'Sorry, I could not start connecting your UIGraph account.'
        : `Connect your UIGraph account first: [Connect UIGraph](${url}). It takes a moment, and after that I answer with your own access.`
    if (thread.isDM) {
      await thread.post({ markdown })
      return
    }
    await thread.postEphemeral(askerId, { markdown }, { fallbackToDM: false })
  }

  // Posts a video into the thread. When it is still rendering, a note goes out now and the file
  // follows once it is ready.
  async function deliverVideo(
    thread: Thread<ThreadState>,
    teamId: string | undefined,
    askerId: string,
    connection: McpConnection,
    docId: string
  ) {
    const watch = env.UIGRAPH_FRONTEND_URL
      ? watchUrl(env.UIGRAPH_FRONTEND_URL, docId)
      : undefined
    const first = await showVideo(connection.client, docId)
    // The rendering notice is removed once the video itself is posted.
    const notice =
      first.status === 'pending'
        ? await thread.post({
            card: asCard(
              <Card title="Rendering the video">
                <CardText>
                  It will play here once it is ready. This can take a few
                  minutes.
                </CardText>
                {watch && (
                  <Actions>
                    <LinkButton url={watch}>Watch in UIGraph</LinkButton>
                  </Actions>
                )}
              </Card>
            ),
            fallbackText:
              'Rendering the video. It will play here once it is ready.',
          })
        : undefined
    inBackground(`Video ${docId}`, async () => {
      const result = await uploadWhenRendered({
        docId,
        show: async (id) =>
          showVideo((await connectionFor(teamId, askerId)).client, id),
        deliver: async (video) => {
          await thread.post(videoMessage(video, docId))
          await notice
            ?.delete()
            .catch((error: unknown) =>
              log.warn('Could not remove the rendering notice', error)
            )
        },
        log: (message) => log.warn(message),
      })
      log.info(`Video ${docId} follow-up: ${result}`)
      if (result === 'uploaded') return
      await thread.post({
        markdown: watch
          ? `I could not post the video here. [Watch it in UIGraph](${watch}).`
          : 'I could not post the video here. Open it in UIGraph.',
      })
    })
  }

  async function respond(thread: Thread<ThreadState>, request: Request) {
    const teamId = slack.installationId
    let connection: McpConnection
    try {
      connection = await connectionFor(teamId, request.askerId)
    } catch (error) {
      if (error instanceof NotConnectedError) {
        await promptToConnect(thread, teamId, request.askerId)
        return
      }
      throw error
    }

    let saved = await sessions.load(thread.id)
    const cleared = compaction(saved)
    if (cleared.length > 0) {
      log.info(
        `Clearing ${cleared.length} old tool result(s) in thread ${thread.id}`
      )
      await sessions.replace(thread.id, cleared)
      saved = await sessions.load(thread.id)
    }
    const input = await buildTurn(thread, request.askerId, saved, request.extra)

    const turn: TurnDisplay = { posts: [], videos: [], toolOutputs: [] }
    const steps: StepResult<ToolSet>[] = []
    const stream = await answer({
      history: input.history,
      input: input.input.map((message) => message.content),
      tools: {
        ...connection.tools,
        ...displayTools(turn),
        ...outlineTool(thread, turn),
      },
      cacheKey: thread.id,
      abortSignal: thread.signal,
      onStep: (step) => steps.push(step),
    })
    await thread.post(
      new StreamingPlan(withTasks(stream, turn), {
        groupTasks: 'plan',
      })
    )
    // A turn cut short by a newer message is not saved; the next turn reads its question again.
    if (thread.signal.aborted) return
    await sessions.append(thread.id, teamId, [
      ...input.input,
      ...replyMessages(steps, request.askerId),
    ])
    for (const post of turn.posts) {
      await thread.post(post)
    }
    for (const docId of createdVideoIds(turn.toolOutputs)) {
      if (!turn.videos.includes(docId)) turn.videos.push(docId)
    }
    for (const docId of turn.videos) {
      await deliverVideo(thread, teamId, request.askerId, connection, docId)
    }
    log.success(`Replied in thread ${thread.id}`)
  }

  async function respondSafely(thread: Thread<ThreadState>, request: Request) {
    try {
      await respond(thread, request)
    } catch (error) {
      if (thread.signal.aborted) {
        log.info(`Stopped answering in thread ${thread.id}`)
        return
      }
      log.error(`Failed to answer in thread ${thread.id}`, error)
      await thread.post('Sorry, I hit an error answering that.')
    }
  }

  bot.onNewMention(async (thread, message) => {
    log.info(`Mention from ${message.author.userId} in ${thread.channelId}`)
    await thread.subscribe()
    await respondSafely(thread, { askerId: message.author.userId })
  })

  // A followed thread is answered without a mention while one person talks to the bot. Once
  // others join, the bot waits for a mention so it stays out of their conversation.
  bot.onSubscribedMessage(async (thread, message) => {
    if (!message.isMention) {
      const participants = await thread.getParticipants()
      if (participants.some((p) => p.userId !== message.author.userId)) {
        return
      }
    }
    log.info(`Follow-up from ${message.author.userId} in ${thread.id}`)
    await respondSafely(thread, { askerId: message.author.userId })
  })

  bot.onDirectMessage(async (thread, message) => {
    log.info(`DM from ${message.author.userId} in ${thread.channelId}`)
    await respondSafely(thread, { askerId: message.author.userId })
  })

  bot.onAction(ASK_ACTION_IDS, async (event) => {
    const question = event.value
    if (event.thread === null || question === undefined) {
      throw new Error('The ask action came without its thread or question')
    }
    const thread = bot.thread(event.threadId)
    const note = await thread.post(`<@${event.user.userId}> asked: ${question}`)
    await respondSafely(thread, {
      askerId: event.user.userId,
      extra: {
        text: `<author>${event.user.fullName} <${event.user.userId}></author>\n\n${question}`,
        slackMessageId: note.id,
      },
    })
  })

  bot.onAction('message_feedback', async (event) => {
    log.info(
      `Feedback ${event.value} from ${event.user.userId} on message ${event.messageId}`
    )
  })

  function videoModal(serviceId: string | undefined) {
    return (
      <Modal
        callbackId="make_video"
        title="Make a video"
        submitLabel="Plan it"
        privateMetadata={serviceId}
      >
        <TextInput
          id="topic"
          label="What should it explain?"
          placeholder="How an order reaches the restaurant"
          multiline
        />
        <RadioSelect id="length" label="Length" initialOption="60">
          <SelectOption label="1 min" value="60" />
          <SelectOption label="2 min" value="120" />
          <SelectOption label="3 min" value="180" />
        </RadioSelect>
      </Modal>
    )
  }

  bot.onSlashCommand('/uigraph', async (event) => {
    const text = event.text.trim()
    if (text === '' || text === 'video' || text.startsWith('video ')) {
      await event.openModal(videoModal(undefined))
      return
    }
    const sent = await event.channel.post(
      `<@${event.user.userId}> asked: ${text}`
    )
    const thread = bot.thread(sent.threadId)
    await thread.subscribe()
    await respondSafely(thread, {
      askerId: event.user.userId,
      extra: {
        text: `<author>${event.user.fullName} <${event.user.userId}></author>\n\n${text}`,
        slackMessageId: sent.id,
      },
    })
  })

  bot.onAction('make_video', async (event) => {
    await event.openModal(videoModal(event.value))
  })

  // Always offered, even outside the video form, so every turn sends the same tools and the
  // cached prompt prefix stays valid.
  function outlineTool(thread: Thread<ThreadState>, turn: TurnDisplay) {
    return {
      show_outline: tool({
        description:
          'Show the planned video outline for approval. Do not create the video before it is approved.',
        inputSchema: z.object({
          request: z
            .string()
            .describe(
              'What the video should explain, its target length, and the service to attach it to, if any'
            ),
          title: z.string(),
          scenes: z
            .array(z.object({ title: z.string(), shows: z.string() }))
            .min(3)
            .max(12),
        }),
        execute: async (input) => {
          await thread.setState({
            videoPlan: {
              request: input.request,
              outline: { title: input.title, scenes: input.scenes },
            },
          })
          turn.posts.push({
            card: asCard(
              <Card
                title={input.title}
                subtitle={`${input.scenes.length} scenes · waiting for approval`}
              >
                <Table
                  headers={['#', 'Scene', 'Shows']}
                  rows={input.scenes.map((scene, index) => [
                    String(index + 1),
                    scene.title,
                    scene.shows,
                  ])}
                  caption="Planned scenes"
                />
                <Actions>
                  <Button id="approve_video" style="primary">
                    Make this video
                  </Button>
                  <Button id="change_video" actionType="modal">
                    Change it
                  </Button>
                </Actions>
              </Card>
            ),
            fallbackText: `Planned video "${input.title}": ${input.scenes.map((scene) => scene.title).join(', ')}`,
          })
          return 'The outline will appear right below your reply with buttons to approve or change it. Stop and wait for approval.'
        },
      }),
    }
  }

  async function planVideo(
    thread: Thread<ThreadState>,
    askerId: string,
    triggerId: string,
    request: string
  ) {
    await respondSafely(thread, {
      askerId,
      extra: {
        text: `${request}\n\nRead video_authoring_guide and the relevant UIGraph data, then call show_outline with the plan. Do not create the video yet.`,
        slackMessageId: triggerId,
      },
    })
  }

  bot.onModalSubmit('make_video', async (event) => {
    inBackground('Video request', async () => {
      const topic = event.values.topic
      const length = Number(event.values.length)
      if (!topic || !Number.isFinite(length)) {
        throw new Error('The video form came without a topic or length')
      }
      const serviceId = event.privateMetadata || undefined
      const request = `Make a walkthrough video about: ${topic}. Target length ${length} seconds.${serviceId ? ` It is about the service with service_id ${serviceId}; attach the video to it.` : ''}`
      const target = event.relatedThread ?? event.relatedChannel
      if (!target) {
        throw new Error(
          'The video form was submitted without a channel or thread'
        )
      }
      const sent = await target.post({
        card: asCard(
          <Card title="Video request" subtitle={`from <@${event.user.userId}>`}>
            <Fields>
              <Field label="Topic" value={topic} />
              <Field label="Length" value={`${length / 60} min`} />
            </Fields>
          </Card>
        ),
        fallbackText: request,
      })
      const thread = bot.thread(sent.threadId)
      await thread.subscribe()
      await planVideo(thread, event.user.userId, sent.id, request)
    })
  })

  bot.onAction('approve_video', async (event) => {
    if (event.thread === null) {
      throw new Error('The approve action came without its thread')
    }
    const thread = bot.thread(event.threadId)
    const plan = (await thread.state)?.videoPlan
    if (plan === undefined) {
      await thread.postEphemeral(
        event.user,
        'This plan was already approved or replaced.',
        { fallbackToDM: false }
      )
      return
    }
    await thread.setState({ videoPlan: undefined })
    const note = await thread.post(`<@${event.user.userId}> approved the plan.`)
    await respondSafely(thread, {
      askerId: event.user.userId,
      extra: {
        text: `${plan.request}\n\nApproved outline: ${JSON.stringify(plan.outline)}\n\nWrite the video YAML following video_authoring_guide, check it with validate_video, fix any errors, then create it with create_video. The video is posted in the thread on its own once it is made.`,
        slackMessageId: note.id,
      },
    })
  })

  bot.onAction('change_video', async (event) => {
    await event.openModal(
      <Modal
        callbackId="change_video"
        title="Change the plan"
        submitLabel="Re-plan"
      >
        <TextInput id="change" label="What should change?" multiline />
      </Modal>
    )
  })

  bot.onModalSubmit('change_video', async (event) => {
    inBackground('Video change', async () => {
      const change = event.values.change
      if (!event.relatedThread || !change) {
        throw new Error('The change form came without its thread or change')
      }
      const thread = bot.thread(event.relatedThread.id)
      const plan = (await thread.state)?.videoPlan
      if (plan === undefined) {
        await thread.postEphemeral(
          event.user,
          'This plan was already approved or replaced.',
          { fallbackToDM: false }
        )
        return
      }
      const note = await thread.post(
        `<@${event.user.userId}> asked for a change: ${change}`
      )
      await planVideo(
        thread,
        event.user.userId,
        note.id,
        `${plan.request}\nChange requested: ${change}`
      )
    })
  })

  bot.onUninstalled(async (event) => {
    await runtime.forgetTeam?.(event.conversationId)
  })

  return bot
}
