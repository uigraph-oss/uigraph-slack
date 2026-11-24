import { SLACK_BOT_SYSTEM_PROMPT } from '@/constants/system-prompt'
import { env } from '@/env'
import { logger } from '@/logger'
import { resolveAiModel } from '@/provider/ai-sdk'
import type { NewSessionMessage } from '@/slack/session'
import {
  stepCountIs,
  streamText,
  type ModelMessage,
  type StepResult,
  type TextStreamPart,
  type ToolSet,
} from 'ai'
import { inspect } from 'node:util'

const log = logger.withTag('agent')

// Anthropic caches a prompt up to each marked message. The system prompt is marked so every
// thread shares the cached tools and instructions, and the end of the saved conversation so the
// next turn reads it back even when it adds many new messages.
const CACHE_POINT = { anthropic: { cacheControl: { type: 'ephemeral' } } }

type Answer = {
  // The saved conversation, replayed unchanged so its cache stays valid.
  history: ModelMessage[]
  input: ModelMessage[]
  tools: ToolSet
  // Keeps one thread's calls together in OpenAI's prompt cache.
  cacheKey: string
  abortSignal: AbortSignal
  onStep: (step: StepResult<ToolSet>) => void
}

export async function answer(
  request: Answer
): Promise<AsyncIterable<TextStreamPart<ToolSet>>> {
  const history = request.history.map((message, index) =>
    index === request.history.length - 1
      ? {
          ...message,
          providerOptions: { ...message.providerOptions, ...CACHE_POINT },
        }
      : message
  )
  const messages = [...history, ...request.input]
  log.info(
    `Answering thread with ${request.history.length} saved and ${request.input.length} new message(s)`
  )
  log.verbose(`Messages: ${inspect(messages, { depth: null })}`)

  const result = streamText({
    model: await resolveAiModel(),
    tools: request.tools,
    toolOrder: Object.keys(request.tools).sort(),
    stopWhen: stepCountIs(env.LLM_MAX_STEP),
    instructions: {
      role: 'system',
      content: SLACK_BOT_SYSTEM_PROMPT,
      providerOptions: CACHE_POINT,
    },
    messages,
    // Anthropic also caches up to the end of every call's prompt, so each step reads the steps
    // before it from the cache.
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
      openai: { promptCacheKey: request.cacheKey },
    },
    abortSignal: request.abortSignal,
    onStepFinish: (step) => {
      const usage = step.usage
      log.info(
        `Step ${step.stepNumber + 1}: ${usage.inputTokens} input tokens (${usage.inputTokenDetails.cacheReadTokens ?? 0} read from cache, ${usage.inputTokenDetails.cacheWriteTokens ?? 0} written to cache), ${usage.outputTokens} output tokens`
      )
      request.onStep(step)
    },
  })
  return result.fullStream
}

// The model's messages from a turn, to save after its input. Each call's token usage goes on the
// assistant message it produced.
export function replyMessages(
  steps: StepResult<ToolSet>[],
  askerId: string
): NewSessionMessage[] {
  const messages: NewSessionMessage[] = []
  for (const step of steps) {
    for (const content of step.response.messages) {
      if (content.role === 'tool') {
        messages.push({ content, askerId })
        continue
      }
      messages.push({
        content,
        askerId,
        model: step.model.modelId,
        inputTokens: step.usage.inputTokens,
        cacheReadTokens: step.usage.inputTokenDetails.cacheReadTokens,
        cacheWriteTokens: step.usage.inputTokenDetails.cacheWriteTokens,
        outputTokens: step.usage.outputTokens,
      })
    }
  }
  return messages
}
