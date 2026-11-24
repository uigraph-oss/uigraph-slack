import { requireMode } from '@/env'
import { logger } from '@/logger'
import { connectMcp, connectMcpAsUser, type McpConnection } from '@/mcp/client'
import type { Runtime } from '@/runtime'
import { parseShowVideo } from '@/slack/video'
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
import { App, ExpressReceiver } from '@slack/bolt'

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

  const receiver = new ExpressReceiver({
    signingSecret: env.SLACK_SIGNING_SECRET,
  })
  receiver.router.get('/healthz', (_req, res) => {
    res.status(200).send('ok')
  })

  const perUser = env.userOAuth
    ? createPerUser(env, receiver.router)
    : undefined

  const app = new App({
    receiver,
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
    ...(perUser && {
      connectUrl: perUser.connectUrl,
      showVideo: perUser.showVideo,
      frontendUrl: perUser.frontendUrl,
    }),
    getTools: async (teamId, slackUserId) => {
      if (perUser) {
        if (teamId === undefined || slackUserId === undefined) {
          throw new Error('Slack team and user ids are required')
        }
        return (await perUser.connectionFor(teamId, slackUserId)).tools
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

// The part of Express's response this file uses; Express itself comes with Bolt.
type PageResponse = {
  set(name: string, value: string): unknown
  redirect(status: number, url: string): unknown
  status(code: number): { type(type: string): { send(body: string): unknown } }
}

function send(res: PageResponse, result: PageResult): void {
  res.set('Cache-Control', 'no-store')
  // The callback address carries the approval code, so it must not leak as a referrer.
  res.set('Referrer-Policy', 'no-referrer')
  if (result.status === 302 && 'redirect' in result) {
    res.redirect(302, result.redirect)
    return
  }
  if ('html' in result) {
    res.status(result.status).type('html').send(result.html)
  }
}

// Answers as the Slack user who asked, with the access of their own UIGraph account.
function createPerUser(env: HttpEnv, router: ExpressReceiver['router']) {
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
  }

  router.get('/uigraph/connect', (req, res) => {
    const invite =
      typeof req.query.invite === 'string' ? req.query.invite : undefined
    handleConnect(connectDeps, invite).then(
      (result) => send(res, result),
      (error: unknown) => {
        logger.withTag('uigraph').error('Connect failed', error)
        res.status(502).type('text').send('Something went wrong. Try again.')
      }
    )
  })
  router.get('/uigraph/callback', (req, res) => {
    function text(value: unknown): string | undefined {
      return typeof value === 'string' ? value : undefined
    }
    handleCallback(connectDeps, {
      code: text(req.query.code),
      state: text(req.query.state),
      error: text(req.query.error),
    }).then(
      (result) => send(res, result),
      (error: unknown) => {
        logger.withTag('uigraph').error('Callback failed', error)
        res.status(502).type('text').send('Something went wrong. Try again.')
      }
    )
  })

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
    connectUrl: (teamId: string, slackUserId: string) =>
      connectLink(connectDeps, teamId, slackUserId),
    showVideo: async (teamId: string, slackUserId: string, docId: string) => {
      const connection = await connectionFor(teamId, slackUserId)
      const result = await connection.client.callTool({
        name: 'show_video',
        arguments: { doc_id: docId },
      })
      return parseShowVideo(result as { structuredContent?: unknown })
    },
    frontendUrl: userOAuth.UIGRAPH_FRONTEND_URL,
    close: async () => {
      for (const { pending } of connections.values()) {
        await pending.then((c) => c.client.close()).catch(() => {})
      }
      connections.clear()
    },
  }
}
