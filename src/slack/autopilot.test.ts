import { stepCountIs, streamText, tool, type ToolSet } from 'ai'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  SENT_PRIVATELY,
  guardAutopilotTools,
  isAutopilotTool,
} from './autopilot'

const SECRET = 'ENG-123 Fix the checkout race · verdict draft'

const USAGE = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

// A model that leaks: it calls autopilot_suggest_order, then writes every tool result it was
// given into its reply. Whatever it writes is what the bot would post in the thread.
function leakyModel() {
  let call = 0
  return new MockLanguageModelV4({
    doStream: async (options) => {
      call += 1
      if (call === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'autopilot_suggest_order',
                input: '{}',
              },
              {
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: undefined },
                usage: USAGE,
              },
            ],
          }),
        }
      }
      const seen = options.prompt
        .filter((message) => message.role === 'tool')
        .flatMap((message) => message.content)
        .map((part) => JSON.stringify(part))
        .join('\n')
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: seen },
            { type: 'text-end', id: 't' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: USAGE,
            },
          ],
        }),
      }
    },
  })
}

function autopilotTools(execute: () => Promise<string>): ToolSet {
  return {
    autopilot_suggest_order: tool({
      description: 'Suggest the order to work on my tickets',
      inputSchema: z.object({ limit: z.number().optional() }),
      execute,
    }),
  }
}

// Runs one turn the way the bot does and returns everything that would reach Slack or the saved
// thread: the streamed text, every tool result, and the messages saved for the next turn.
async function runTurn(isDM: boolean) {
  const queue = vi.fn(async () => SECRET)
  const onPrivate = vi.fn()
  const result = streamText({
    model: leakyModel(),
    tools: guardAutopilotTools(autopilotTools(queue), isDM, onPrivate),
    stopWhen: stepCountIs(3),
    prompt: 'what should I work on today?',
  })
  const posted: string[] = []
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') posted.push(part.text)
    if (part.type === 'tool-result') posted.push(JSON.stringify(part.output))
  }
  const saved = JSON.stringify((await result.response).messages)
  return { posted: posted.join(''), saved, queue, onPrivate }
}

describe('guardAutopilotTools', () => {
  it('never lets an Autopilot result reach a shared thread, even from a model that echoes it', async () => {
    const turn = await runTurn(false)
    expect(turn.posted).not.toContain(SECRET)
    expect(turn.saved).not.toContain(SECRET)
    expect(turn.queue).not.toHaveBeenCalled()
    expect(turn.onPrivate).toHaveBeenCalled()
    expect(turn.posted).toContain(SENT_PRIVATELY)
  })

  it('runs the real tool in a DM, which is where the answer belongs', async () => {
    const turn = await runTurn(true)
    expect(turn.queue).toHaveBeenCalled()
    expect(turn.onPrivate).not.toHaveBeenCalled()
    expect(turn.posted).toContain(SECRET)
  })

  it('leaves every other tool alone', () => {
    const other = tool({
      description: 'List services',
      inputSchema: z.object({}),
      execute: async () => 'services',
    })
    const guarded = guardAutopilotTools(
      { list_services: other },
      false,
      () => {}
    )
    expect(guarded.list_services).toBe(other)
  })
})

describe('isAutopilotTool', () => {
  it('matches the Autopilot tools by prefix', () => {
    expect(isAutopilotTool('autopilot_suggest_order')).toBe(true)
    expect(isAutopilotTool('autopilot_status')).toBe(true)
    expect(isAutopilotTool('autopilot_feedback')).toBe(true)
    expect(isAutopilotTool('list_services')).toBe(false)
  })
})
