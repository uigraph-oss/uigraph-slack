import { env } from '@/env'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

let cachedModel: LanguageModel | null = null

export async function resolveAiModel(): Promise<LanguageModel> {
  if (cachedModel) return cachedModel

  const provider = createOpenAICompatible({
    name: 'Custom AI Provider',
    baseURL: env.AI_PROVIDER_API_URL!,
    apiKey: env.AI_PROVIDER_API_KEY,
  })

  cachedModel = provider(env.AI_PROVIDER_MODEL)
  return cachedModel
}
