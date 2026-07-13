import { SUPPORTED_PROVIDERS } from '@/constants/providers'
import { env } from '@/env'
import type { LanguageModel, Provider } from 'ai'

let cachedModel: LanguageModel | null = null

export async function resolveAiModel(): Promise<LanguageModel> {
  if (cachedModel) return cachedModel

  const npm = env.AI_PROVIDER_NPM as keyof typeof SUPPORTED_PROVIDERS
  if (!(npm in SUPPORTED_PROVIDERS)) {
    throw new Error(
      `Unsupported provider: ${npm}. Supported providers are: ${Object.keys(SUPPORTED_PROVIDERS).join(', ')}.`
    )
  }

  if (npm === '@ai-sdk/openai-compatible' && !env.AI_PROVIDER_API_URL) {
    throw new Error(
      'AI_PROVIDER_API_URL is required for openai-compatible provider'
    )
  }

  const mod = await import(npm)
  const provider: Provider = mod[SUPPORTED_PROVIDERS[npm].create]({
    name: npm,
    apiKey: env.AI_PROVIDER_API_KEY,
    baseURL: env.AI_PROVIDER_API_URL,
  })

  cachedModel = provider.languageModel(env.AI_PROVIDER_MODEL)
  return cachedModel
}
