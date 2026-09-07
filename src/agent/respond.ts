import { SLACK_BOT_SYSTEM_PROMPT } from '@/constants/system-prompt'
import { env } from '@/env'
import { logger } from '@/logger'
import { getTools } from '@/mcp/client'
import { resolveAiModel } from '@/provider/ai-sdk'
import { generateText, stepCountIs, type ModelMessage } from 'ai'
import { inspect } from 'node:util'

export async function answer(
  messages: ModelMessage[],
  teamId: string | undefined
): Promise<{ text: string; toolOutputs: string[] }> {
  const log = logger.withTag('agent')
  log.info(`Answering thread with ${messages.length} message(s)`)
  log.verbose(`Messages: ${inspect(messages, { depth: null })}`)

  const result = await generateText({
    model: await resolveAiModel(),
    tools: await getTools(teamId),
    stopWhen: stepCountIs(env.LLM_MAX_STEP),
    system: SLACK_BOT_SYSTEM_PROMPT,
    messages,
  })

  const toolOutputs: string[] = []
  for (const step of result.steps) {
    for (const call of step.toolCalls) {
      log.debug(
        `MCP ${call.toolName} input: ${inspect(call.input, { depth: null })}`
      )
    }
    for (const toolResult of step.toolResults) {
      log.verbose(
        `MCP ${toolResult.toolName} output: ${inspect(toolResult.output, { depth: null })}`
      )

      const output = toolResult.output as {
        content?: Array<{ type?: string; text?: string }>
        isError?: boolean
      }
      if (output.isError === true) {
        continue
      }
      for (const part of output.content ?? []) {
        if (part.type === 'text' && typeof part.text === 'string') {
          toolOutputs.push(part.text)
        }
      }
    }
  }

  log.verbose('Result:', inspect(result, { depth: null }))
  return { text: result.text, toolOutputs }
}
