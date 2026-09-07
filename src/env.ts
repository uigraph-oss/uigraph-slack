import { z } from 'zod'

const sharedSchema = z.object({
  SLACK_BOT_DEBUG_MODE: z.stringbool().default(false),

  UIGRAPH_API_URL: z.url(),
  UIGRAPH_MCP_URL: z.url(),

  AI_PROVIDER_NPM: z.string().default('@ai-sdk/openai-compatible'),
  AI_PROVIDER_OPTIONS: z
    .string()
    .optional()
    .transform((value) => (value ? JSON.parse(value) : undefined))
    .pipe(z.record(z.string(), z.unknown()).optional()),

  AI_PROVIDER_API_URL: z.url().optional(),
  AI_PROVIDER_API_KEY: z.string(),
  AI_PROVIDER_MODEL: z.string(),

  LLM_MAX_STEP: z.coerce.number().default(100),
  LLM_MESSAGES_LIMIT: z.coerce.number().default(25),

  LLM_ATTACHMENT_IMAGE: z.stringbool().default(false),
  LLM_ATTACHMENT_AUDIO: z.stringbool().default(false),
  LLM_ATTACHMENT_VIDEO: z.stringbool().default(false),
})

const socketSchema = sharedSchema.extend({
  SLACK_BOT_TOKEN: z.string(),
  SLACK_APP_TOKEN: z.string(),
  UIGRAPH_TOKEN: z.string(),
})

const httpSchema = sharedSchema.extend({
  SLACK_SIGNING_SECRET: z.string(),
  UIGRAPH_ENTERPRISE_INTERNAL_TOKEN: z.string(),
})

function loadEnv() {
  const enterprise = z
    .stringbool()
    .default(false)
    .parse(process.env.UIGRAPH_ENTERPRISE)

  if (enterprise) {
    return { mode: 'http' as const, ...httpSchema.parse(process.env) }
  }
  return { mode: 'socket' as const, ...socketSchema.parse(process.env) }
}

export const env = loadEnv()

export type Env = typeof env

export function requireMode<M extends Env['mode']>(
  mode: M
): Extract<Env, { mode: M }> {
  if (env.mode !== mode) {
    throw new Error(`Expected ${mode} mode but running in ${env.mode} mode`)
  }
  return env as Extract<Env, { mode: M }>
}

if (!env.AI_PROVIDER_NPM && !env.AI_PROVIDER_API_URL) {
  throw new Error('AI provider is not configured')
}
