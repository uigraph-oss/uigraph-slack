import { env } from '@/env'
import { resolveAiModel as resolve } from '@uigraph/ai-sdk'
import type { LanguageModel } from 'ai'

let cachedModel: LanguageModel | null = null

export async function resolveAiModel(): Promise<LanguageModel> {
  if (cachedModel) return cachedModel

  cachedModel = await resolve({
    npm: env.AI_PROVIDER_NPM,
    model: env.AI_PROVIDER_MODEL,
    apiKey: env.AI_PROVIDER_API_KEY,
    apiUrl: env.AI_PROVIDER_API_URL,
    options: env.AI_PROVIDER_OPTIONS,
  })

  return cachedModel
}
