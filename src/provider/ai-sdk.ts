import { env } from '@/env'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

const provider = createOpenAICompatible({
  name: 'Custom AI Provider',
  baseURL: env.AI_PROVIDER_URL,
  apiKey: env.AI_PROVIDER_API_KEY,
})

export const aiModel: LanguageModel = provider(env.AI_PROVIDER_MODEL)
