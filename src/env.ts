import { z } from 'zod'

const sharedSchema = z.object({
  SLACK_BOT_DEBUG_MODE: z.stringbool().default(false),
  // Turn on when the Slack app has the agent experience (agent_view) enabled in its manifest.
  SLACK_AGENT_VIEW: z.stringbool().default(false),

  UIGRAPH_API_URL: z.url(),
  UIGRAPH_MCP_URL: z.url(),
  // Where people open UIGraph, for "Watch in UIGraph" buttons. Without it the buttons are left out.
  UIGRAPH_FRONTEND_URL: z.url().optional(),

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
  // Once a thread's conversation passes this many tokens, tool results from before the latest
  // turn are cleared from it.
  LLM_CONTEXT_TOKENS: z.coerce.number().default(100000),

  LLM_ATTACHMENT_IMAGE: z.stringbool().default(false),
  LLM_ATTACHMENT_AUDIO: z.stringbool().default(false),
  LLM_ATTACHMENT_VIDEO: z.stringbool().default(false),
})

const socketSchema = sharedSchema.extend({
  SLACK_BOT_TOKEN: z.string(),
  SLACK_APP_TOKEN: z.string(),
  UIGRAPH_TOKEN: z.string(),
  // Optional here: with it the bot keeps its state in UIGraph instead of in memory.
  UIGRAPH_ENTERPRISE_INTERNAL_TOKEN: z.string().optional(),
})

// Per-user connection (optional). Set UIGRAPH_OAUTH_CLIENT_ID to turn it on: each Slack user then
// approves their own UIGraph account once and the app acts as them. Left unset, HTTP mode keeps
// using the workspace's service account as before.
const userOAuthSchema = z.object({
  UIGRAPH_OAUTH_CLIENT_ID: z.string().min(1),
  // This app's public address; /uigraph/callback is registered with the OAuth client.
  SLACK_APP_PUBLIC_URL: z.url(),
  // The MCP server's public address, which each grant is bound to.
  UIGRAPH_MCP_PUBLIC_URL: z.url(),
  // Where people open UIGraph, for watch links.
  UIGRAPH_FRONTEND_URL: z.url(),
  // Consent page, when it is not UIGRAPH_FRONTEND_URL + /oauth/consent.
  UIGRAPH_OAUTH_AUTHORIZE_URL: z.url().optional(),
  // Seals the connect link and OAuth state; defaults to the Slack signing secret.
  SLACK_APP_STATE_SECRET: z.string().min(16).optional(),
})

const httpSchema = sharedSchema.extend({
  SLACK_SIGNING_SECRET: z.string(),
  UIGRAPH_ENTERPRISE_INTERNAL_TOKEN: z.string(),
  UIGRAPH_OAUTH_CLIENT_ID: z.string().optional(),
})

function loadEnv() {
  const enterprise = z
    .stringbool()
    .default(false)
    .parse(process.env.UIGRAPH_ENTERPRISE)

  if (enterprise) {
    const http = httpSchema.parse(process.env)
    const userOAuth = http.UIGRAPH_OAUTH_CLIENT_ID
      ? userOAuthSchema.parse(process.env)
      : undefined
    return { mode: 'http' as const, ...http, userOAuth }
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
