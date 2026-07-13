import { env } from '@/env'
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

  mcpClient = await createMCPClient({ transport })
  uigraphTools = await mcpClient.tools()

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
    await mcpClient.close()
  }
}
