import { env } from '@/env'
import { connectMcpTools, type McpClient } from '@uigraph/ai-sdk'
import type { ToolSet } from 'ai'

export type McpConnection = { client: McpClient; tools: ToolSet }

export async function connectMcp(accessToken: string): Promise<McpConnection> {
  const { client, tools } = await connectMcpTools({
    url: env.UIGRAPH_MCP_URL,
    accessToken,
    authType: 'service_account',
    clientName: 'UiGraph Slack',
  })
  return { client, tools }
}
