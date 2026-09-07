import { env } from '@/env'
import { logger } from '@/logger'
import { getInstallation } from '@/uigraph/installations'
import { connectMcpTools, type McpClient } from '@uigraph/ai-sdk'
import type { ToolSet } from 'ai'

type Connection = { client: McpClient; tools: ToolSet }

let globalConnection: Connection | undefined
const teamConnections = new Map<string, Promise<Connection>>()

async function connect(accessToken: string): Promise<Connection> {
  const { client, tools } = await connectMcpTools({
    url: env.UIGRAPH_MCP_URL,
    accessToken,
    authType: 'service_account',
    clientName: 'UiGraph Slack',
  })
  return { client, tools }
}

export async function initMcp(): Promise<ToolSet> {
  if (env.mode !== 'socket') {
    throw new Error('initMcp is only used in socket mode')
  }

  logger
    .withTag('mcp')
    .info(`Connecting to MCP server at ${env.UIGRAPH_MCP_URL}`)

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      globalConnection = await connect(env.UIGRAPH_TOKEN)

      logger
        .withTag('mcp')
        .success(
          `Loaded ${Object.keys(globalConnection.tools).length} tools: ${Object.keys(globalConnection.tools).join(', ')}`
        )

      return globalConnection.tools
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

async function connectTeam(teamId: string): Promise<Connection> {
  const installation = await getInstallation(teamId)
  if (installation === undefined) {
    throw new Error(`No UiGraph installation for Slack team ${teamId}`)
  }

  logger
    .withTag('mcp')
    .info(
      `Connecting to MCP server for team ${teamId} (org ${installation.orgId})`
    )
  const connection = await connect(installation.uigraphToken)
  logger
    .withTag('mcp')
    .success(
      `Loaded ${Object.keys(connection.tools).length} tools for team ${teamId}`
    )
  return connection
}

export async function getTools(teamId: string | undefined): Promise<ToolSet> {
  if (env.mode === 'socket') {
    if (!globalConnection) {
      throw new Error('MCP client not initialized')
    }
    return globalConnection.tools
  }

  if (teamId === undefined) {
    throw new Error('Slack team id is required in HTTP mode')
  }

  let pending = teamConnections.get(teamId)
  if (pending === undefined) {
    pending = connectTeam(teamId)
    teamConnections.set(teamId, pending)
    pending.catch(() => {
      teamConnections.delete(teamId)
    })
  }
  const connection = await pending
  return connection.tools
}

export async function closeTeamMcp(teamId: string): Promise<void> {
  const pending = teamConnections.get(teamId)
  teamConnections.delete(teamId)
  if (pending === undefined) {
    return
  }
  try {
    const connection = await pending
    await connection.client.close()
  } catch (error) {
    logger
      .withTag('mcp')
      .error(`Failed to close MCP client for team ${teamId}`, error)
  }
}

export async function closeMcp(): Promise<void> {
  if (globalConnection) {
    logger.withTag('mcp').info('Closing MCP client')
    await globalConnection.client.close()
  }
  for (const teamId of [...teamConnections.keys()]) {
    await closeTeamMcp(teamId)
  }
}
