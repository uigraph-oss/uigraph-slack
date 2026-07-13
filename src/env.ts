import { z } from 'zod'

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string(),
  SLACK_APP_TOKEN: z.string(),
  SLACK_SIGNING_SECRET: z.string(),

  UIGRAPH_API_URL: z.url(),
  UIGRAPH_MCP_URL: z.url(),

  UIGRAPH_ORG_ID: z.string(),
  UIGRAPH_ACCESS_TOKEN: z.string(),

  AI_PROVIDER_URL: z.url(),
  AI_PROVIDER_MODEL: z.string(),
  AI_PROVIDER_API_KEY: z.string(),
})

export const env = envSchema.parse(process.env)
