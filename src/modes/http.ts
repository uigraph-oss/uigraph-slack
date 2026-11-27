import { requireMode } from '@/env'
import { logger } from '@/logger'
import { connectMcp, connectMcpAsUser, type McpConnection } from '@/mcp/client'
import type { Runtime } from '@/runtime'
import {
  connectLink,
  handleCallback,
  handleConnect,
  type ConnectDeps,
  type PageResult,
} from '@/uigraph/connect'
import {
  evictInstallation,
  getInstallation,
  removeInstallation,
} from '@/uigraph/installations'
import type { OAuthConfig } from '@/uigraph/oauth'
import { createLinkStore, createUserTokens } from '@/uigraph/user-links'

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

  async function forgetTeam(teamId: string): Promise<void> {
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

  const perUser = env.userOAuth ? createPerUser(env) : undefined

  return {
    slack: {
      mode: 'webhook',
      signingSecret: env.SLACK_SIGNING_SECRET,
      installationProvider: {
        getInstallation: async (teamId) => {
          const installation = await getInstallation(teamId)
          if (installation === undefined) {
            logger
              .withTag('slack')
              .warn(`Slack team ${teamId} is not connected to UiGraph`)
            return null
          }
          return {
            botToken: installation.botToken,
            botUserId: installation.botUserId,
          }
        },
      },
    },
    ...(perUser && { connectUrl: perUser.connectUrl }),
    forgetTeam,
    page: async (request) => {
      const url = new URL(request.url)
      if (request.method === 'GET' && url.pathname === '/healthz') {
        return new Response('ok')
      }
      if (perUser && request.method === 'GET') {
        const response = await perUser.page(url)
        if (response !== undefined) return response
      }
      return new Response('Not found', { status: 404 })
    },
    connection: async (teamId, slackUserId) => {
      if (teamId === undefined) {
        throw new Error('Slack team id is required in HTTP mode')
      }
      if (perUser) {
        return perUser.connectionFor(teamId, slackUserId)
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
      return pending
    },
    close: async () => {
      for (const teamId of [...teamConnections.keys()]) {
        await closeTeam(teamId)
      }
      await perUser?.close()
    },
  }
}

type HttpEnv = ReturnType<typeof requireMode<'http'>>

// Opens the bot's DM with one Slack user and posts text there, with the installation's bot token.
async function dmSlackUser(
  botToken: string,
  slackUserId: string,
  text: string
): Promise<void> {
  async function call(method: string, body: Record<string, string>) {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    })
    const out = (await response.json()) as {
      ok?: boolean
      error?: string
      channel?: { id?: string }
    }
    if (!out.ok) throw new Error(`Slack ${method}: ${out.error ?? 'failed'}`)
    return out
  }
  const opened = await call('conversations.open', { users: slackUserId })
  const channel = opened.channel?.id
  if (!channel) throw new Error('Slack conversations.open returned no channel')
  await call('chat.postMessage', { channel, text })
}

function toResponse(result: PageResult): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    // The callback address carries the approval code, so it must not leak as a referrer.
    'Referrer-Policy': 'no-referrer',
  })
  if ('redirect' in result) {
    headers.set('Location', result.redirect)
    return new Response(null, { status: 302, headers })
  }
  headers.set('Content-Type', 'text/html; charset=utf-8')
  return new Response(result.html, { status: result.status, headers })
}

async function pageOrError(
  label: string,
  work: () => Promise<PageResult>
): Promise<Response> {
  try {
    return toResponse(await work())
  } catch (error) {
    logger.withTag('uigraph').error(`${label} failed`, error)
    return new Response('Something went wrong. Try again.', { status: 502 })
  }
}

// Answers as the Slack user who asked, with the access of their own UIGraph account.
function createPerUser(env: HttpEnv) {
  const userOAuth = env.userOAuth
  if (!userOAuth) {
    throw new Error('Per-user connection is not configured')
  }
  const publicUrl = userOAuth.SLACK_APP_PUBLIC_URL.replace(/\/$/, '')
  const oauth: OAuthConfig = {
    apiUrl: env.UIGRAPH_API_URL.replace(/\/$/, ''),
    clientId: userOAuth.UIGRAPH_OAUTH_CLIENT_ID,
    redirectUri: `${publicUrl}/uigraph/callback`,
    resource: userOAuth.UIGRAPH_MCP_PUBLIC_URL,
    authorizeUrl:
      userOAuth.UIGRAPH_OAUTH_AUTHORIZE_URL ??
      `${userOAuth.UIGRAPH_FRONTEND_URL.replace(/\/$/, '')}/oauth/consent`,
  }
  const links = createLinkStore(
    oauth.apiUrl,
    env.UIGRAPH_ENTERPRISE_INTERNAL_TOKEN
  )
  const tokens = createUserTokens({ links, oauth })
  const connectDeps: ConnectDeps = {
    oauth,
    publicUrl,
    secret: userOAuth.SLACK_APP_STATE_SECRET ?? env.SLACK_SIGNING_SECRET,
    links,
    installationOrg: async (teamId) => (await getInstallation(teamId))?.orgId,
    botUserId: async (teamId) => (await getInstallation(teamId))?.botUserId,
    notifyConnected: async (teamId, slackUserId, text) => {
      const installation = await getInstallation(teamId)
      if (installation === undefined) return
      try {
        await dmSlackUser(installation.botToken, slackUserId, text)
      } catch (error) {
        logger.withTag('uigraph').warn('Connected notice failed', error)
      }
    },
  }

  async function page(url: URL): Promise<Response | undefined> {
    const query = url.searchParams
    if (url.pathname === '/uigraph/connect') {
      return pageOrError('Connect', () =>
        handleConnect(connectDeps, query.get('invite') ?? undefined)
      )
    }
    if (url.pathname === '/uigraph/callback') {
      return pageOrError('Callback', () =>
        handleCallback(connectDeps, {
          code: query.get('code') ?? undefined,
          state: query.get('state') ?? undefined,
          error: query.get('error') ?? undefined,
        })
      )
    }
    return undefined
  }

  // One MCP connection per Slack user. It is made with the user's current access token, so a
  // refreshed token means a new connection; the old one is closed a little later, once any
  // request still using it is done.
  const connections = new Map<
    string,
    { token: string; pending: Promise<McpConnection> }
  >()
  const CLOSE_AFTER_MS = 60_000

  async function connectionFor(
    teamId: string,
    slackUserId: string
  ): Promise<McpConnection> {
    const access = await tokens.getAccess(teamId, slackUserId)
    const key = `${teamId}:${slackUserId}`
    const existing = connections.get(key)
    if (existing?.token === access.accessToken) {
      return existing.pending
    }
    if (existing) {
      void existing.pending
        .then(
          (connection) =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                connection.client.close().catch(() => {})
                resolve()
              }, CLOSE_AFTER_MS)
            })
        )
        .catch(() => {})
    }
    const pending = connectMcpAsUser(access.accessToken, access.orgId)
    connections.set(key, { token: access.accessToken, pending })
    pending.catch(() => {
      if (connections.get(key)?.pending === pending) connections.delete(key)
    })
    return pending
  }

  return {
    connectionFor,
    page,
    connectUrl: (teamId: string, slackUserId: string) =>
      connectLink(connectDeps, teamId, slackUserId),
    close: async () => {
      for (const { pending } of connections.values()) {
        await pending.then((c) => c.client.close()).catch(() => {})
      }
      connections.clear()
    },
  }
}
