import { requireMode } from '@/env'
import { logger } from '@/logger'
import { connectMcp, type McpConnection } from '@/mcp/client'
import type { Runtime } from '@/runtime'
import { App } from '@slack/bolt'

const MCP_CONNECT_ATTEMPTS = 10

async function connectWithRetry(accessToken: string): Promise<McpConnection> {
  for (let attempt = 1; attempt <= MCP_CONNECT_ATTEMPTS; attempt += 1) {
    try {
      return await connectMcp(accessToken)
    } catch (error) {
      if (attempt === MCP_CONNECT_ATTEMPTS) {
        throw error
      }
      logger
        .withTag('mcp')
        .warn(
          `MCP connection failed; retrying (${attempt}/${MCP_CONNECT_ATTEMPTS})`
        )
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000)
      })
    }
  }
  throw new Error('MCP connection failed.')
}

export async function createSocketRuntime(): Promise<Runtime> {
  const env = requireMode('socket')

  logger
    .withTag('mcp')
    .info(`Connecting to MCP server at ${env.UIGRAPH_MCP_URL}`)
  const connection = await connectWithRetry(env.UIGRAPH_TOKEN)
  logger
    .withTag('mcp')
    .success(
      `Loaded ${Object.keys(connection.tools).length} tools: ${Object.keys(connection.tools).join(', ')}`
    )

  const app = new App({
    token: env.SLACK_BOT_TOKEN,
    appToken: env.SLACK_APP_TOKEN,
    socketMode: true,
  })

  return {
    app,
    getTools: async () => connection.tools,
    close: async () => {
      logger.withTag('mcp').info('Closing MCP client')
      await connection.client.close()
    },
  }
}
