import { z } from 'zod'

const envSchema = z.object({
  SLACK_BOT_DEBUG_MODE: z.stringbool().default(false),

  SLACK_BOT_TOKEN: z.string(),
  SLACK_APP_TOKEN: z.string(),

  UIGRAPH_API_URL: z.url(),
  UIGRAPH_MCP_URL: z.url(),

  UIGRAPH_ACCESS_TOKEN: z.string(),

  AI_PROVIDER_NPM: z.string().default('@ai-sdk/openai-compatible'),
  AI_PROVIDER_OPTIONS: z
    .string()
    .optional()
    .transform((value) => (value ? JSON.parse(value) : undefined))
    .pipe(z.record(z.string(), z.unknown()).optional()),

  AI_PROVIDER_API_URL: z.url().optional(),
  AI_PROVIDER_API_KEY: z.string(),
  AI_PROVIDER_MODEL: z.string(),

  LLM_MAX_STEP: z.coerce.number().default(25),
  LLM_MESSAGES_LIMIT: z.coerce.number().default(25),

  LLM_ATTACHMENT_IMAGE: z.stringbool().default(false),
  LLM_ATTACHMENT_AUDIO: z.stringbool().default(false),
  LLM_ATTACHMENT_VIDEO: z.stringbool().default(false),
})

export const env = envSchema.parse(process.env)
