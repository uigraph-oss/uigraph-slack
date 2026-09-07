import { requireMode } from '@/env'
import { logger } from '@/logger'
import { connectMcp, type McpConnection } from '@/mcp/client'
import type { Runtime } from '@/runtime'
import {
  evictInstallation,
  getInstallation,
  removeInstallation,
} from '@/uigraph/installations'
import { App } from '@slack/bolt'

async function connectTeam(teamId: string): Promise<McpConnection> {
  const installation = await getInstallation(teamId)
  if (installation === undefined) {
    throw new Error(`No UiGraph installation for Slack team ${teamId}`)
  }

  logger
    .withTag('mcp')
    .info(
      `Connecting to MCP server for team ${teamId} (org ${installation.orgId})`
    )
  const connection = await connectMcp(installation.uigraphToken)
  logger
    .withTag('mcp')
    .success(
      `Loaded ${Object.keys(connection.tools).length} tools for team ${teamId}`
    )
  return connection
}

export async function createHttpRuntime(): Promise<Runtime> {
  const env = requireMode('http')
  const teamConnections = new Map<string, Promise<McpConnection>>()

  async function closeTeam(teamId: string): Promise<void> {
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

  async function forgetTeam(teamId: string | undefined): Promise<void> {
    if (teamId === undefined) {
      logger.withTag('slack').warn('Uninstall event without team id')
      return
    }
    logger.withTag('slack').info(`App removed from team ${teamId}`)
    evictInstallation(teamId)
    await closeTeam(teamId)
    try {
      await removeInstallation(teamId)
    } catch (error) {
      logger
        .withTag('slack')
        .error(`Failed to remove installation for team ${teamId}`, error)
    }
  }

  const app = new App({
    signingSecret: env.SLACK_SIGNING_SECRET,
    authorize: async ({ teamId }) => {
      if (teamId === undefined) {
        throw new Error('Slack event without team id is not supported')
      }
      const installation = await getInstallation(teamId)
      if (installation === undefined) {
        throw new Error(`Slack team ${teamId} is not connected to UiGraph`)
      }
      return {
        botToken: installation.botToken,
        botUserId: installation.botUserId,
        teamId: installation.teamId,
      }
    },
  })

  app.event('app_uninstalled', async ({ context }) => {
    await forgetTeam(context.teamId)
  })

  app.event('tokens_revoked', async ({ event, context }) => {
    if ((event.tokens.bot ?? []).length === 0) {
      return
    }
    await forgetTeam(context.teamId)
  })

  return {
    app,
    getTools: async (teamId) => {
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
    },
    close: async () => {
      for (const teamId of [...teamConnections.keys()]) {
        await closeTeam(teamId)
      }
    },
  }
}
