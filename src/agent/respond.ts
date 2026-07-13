import { logger } from '@/logger'
import { getTools } from '@/mcp/client'
import { aiModel } from '@/provider/ai-sdk'
import { generateText, stepCountIs } from 'ai'

const systemPrompt = `You are the UiGraph assistant, a Slack bot that answers questions about a software organization's architecture: its services, diagrams, API specs, database schemas, and system maps.

Answer using the provided UiGraph tools. Prefer real data from the tools over guessing. If the tools do not have the information, say so plainly instead of inventing an answer. Keep replies concise and suited to a Slack message.`

export async function answer(question: string): Promise<string> {
  const log = logger.withTag('agent')
  log.info(`Question: ${question}`)

  const result = await generateText({
    model: aiModel,
    tools: getTools(),
    stopWhen: stepCountIs(6),
    system: systemPrompt,
    prompt: question,
  })

  for (const step of result.steps) {
    for (const call of step.toolCalls) {
      log.info(`Tool call: ${call.toolName}`, call.input)
    }
  }

  log.success(
    `Answer ready in ${result.steps.length} step(s), ${result.usage.totalTokens ?? 0} tokens`
  )

  return result.text
}
