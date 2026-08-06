import { env } from '@/env'
import { logger } from '@/logger'
import { connectMcpTools, type McpClient } from '@uigraph/ai-sdk'
import type { ToolSet } from 'ai'

let mcpClient: McpClient | undefined
let uigraphTools: ToolSet | undefined

export async function initMcp(): Promise<ToolSet> {
  logger
    .withTag('mcp')
    .info(`Connecting to MCP server at ${env.UIGRAPH_MCP_URL}`)

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const { client, tools } = await connectMcpTools({
        url: env.UIGRAPH_MCP_URL,
        accessToken: env.UIGRAPH_TOKEN,
        authType: 'service_account',
        clientName: 'UiGraph Slack',
      })

      mcpClient = client
      uigraphTools = tools

      logger
        .withTag('mcp')
        .success(
          `Loaded ${Object.keys(uigraphTools).length} tools: ${Object.keys(uigraphTools).join(', ')}`
        )

      return uigraphTools
    } catch (error) {
      if (attempt === 10) {
        throw error
      }

      logger
        .withTag('mcp')
        .warn(`MCP connection failed; retrying (${attempt}/10)`)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000)
      })
    }
  }

  throw new Error('MCP connection failed.')
}

export function getTools(): ToolSet {
  if (!uigraphTools) {
    throw new Error('MCP client not initialized')
  }

  return uigraphTools
}

export async function closeMcp(): Promise<void> {
  if (mcpClient) {
    logger.withTag('mcp').info('Closing MCP client')
    await mcpClient.close()
  }
}
