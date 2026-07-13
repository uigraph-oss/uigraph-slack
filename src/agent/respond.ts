import { SLACK_BOT_SYSTEM_PROMPT } from '@/constants/system-prompt'
import { env } from '@/env'
import { logger } from '@/logger'
import { getTools } from '@/mcp/client'
import { aiModel } from '@/provider/ai-sdk'
import { generateText, stepCountIs, type ModelMessage } from 'ai'
import { inspect } from 'node:util'

export async function answer(messages: ModelMessage[]): Promise<string> {
  const log = logger.withTag('agent')
  log.info(`Answering thread with ${messages.length} message(s)`)

  log.info(`Messages: ${inspect(messages, { depth: null })}`)

  const result = await generateText({
    model: aiModel,
    tools: getTools(),
    stopWhen: stepCountIs(env.LLM_MAX_STEP),
    system: SLACK_BOT_SYSTEM_PROMPT,
    messages,
  })

  for (const step of result.steps) {
    for (const call of step.toolCalls) {
      log.info(
        `MCP ${call.toolName} input: ${inspect(call.input, { depth: null })}`
      )
    }
    for (const toolResult of step.toolResults) {
      log.info(
        `MCP ${toolResult.toolName} output: ${inspect(toolResult.output, { depth: null })}`
      )
    }
  }

  log.success(
    `Answer ready in ${result.steps.length} step(s), ${result.usage.totalTokens ?? 0} tokens`
  )

  return result.text
}
