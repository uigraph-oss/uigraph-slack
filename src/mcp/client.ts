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

  const { client, tools } = await connectMcpTools({
    url: env.UIGRAPH_MCP_URL,
    orgId: env.UIGRAPH_ORG_ID,
    accessToken: env.UIGRAPH_ACCESS_TOKEN,
    authType: 'service-account',
  })

  mcpClient = client
  uigraphTools = tools

  logger
    .withTag('mcp')
    .success(
      `Loaded ${Object.keys(uigraphTools).length} tools: ${Object.keys(uigraphTools).join(', ')}`
    )

  return uigraphTools
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
