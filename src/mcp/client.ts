import { env } from '@/env'
import { connectMcpTools, type McpClient } from '@uigraph/ai-sdk'
import type { ToolSet } from 'ai'
import { onlySafeTools } from './tools'

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

// Connects as one person, with the access token of their own grant. Only tools that read or add
// are offered (see isSafeTool).
export async function connectMcpAsUser(
  accessToken: string,
  orgId: string
): Promise<McpConnection> {
  const { client, tools } = await connectMcpTools({
    url: env.UIGRAPH_MCP_URL,
    accessToken,
    orgId,
    authType: 'user',
    clientName: 'UiGraph Slack',
  })
  return { client, tools: await onlySafeTools(client, tools) }
}
