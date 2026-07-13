import { env } from '@/env'
import { logger } from '@/logger'
import { createMCPClient } from '@ai-sdk/mcp'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ToolSet } from 'ai'

type MCPClient = Awaited<ReturnType<typeof createMCPClient>>

let mcpClient: MCPClient | undefined
let uigraphTools: ToolSet | undefined

export async function initMcp(): Promise<ToolSet> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.UIGRAPH_ACCESS_TOKEN}`,
  }

  if (env.UIGRAPH_ORG_ID) {
    headers['X-UIGraph-Org-Id'] = env.UIGRAPH_ORG_ID
  }

  const transport = new StreamableHTTPClientTransport(
    new URL(env.UIGRAPH_MCP_URL),
    {
      requestInit: { headers },
    }
  )

  logger
    .withTag('mcp')
    .info(`Connecting to MCP server at ${env.UIGRAPH_MCP_URL}`)

  mcpClient = await createMCPClient({ transport })
  uigraphTools = await mcpClient.tools()

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
