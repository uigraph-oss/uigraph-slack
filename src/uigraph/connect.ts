import {
  buildAuthorizeUrl,
  exchangeCode,
  pkce,
  whoAmI,
  type OAuthConfig,
} from './oauth'
import { seal, unseal } from './seal'
import type { LinkStore } from './user-links'

// The two pages that connect a Slack user to UIGraph. The bot hands out a connect link in Slack;
// opening it sends the user to UIGraph's consent page, and the callback stores the result.

const INVITE_TTL_MS = 30 * 60_000
const STATE_TTL_MS = 10 * 60_000

type Invite = { purpose: 'invite'; teamId: string; slackUserId: string }
type State = {
  purpose: 'state'
  teamId: string
  slackUserId: string
  verifier: string
}

export type ConnectDeps = {
  oauth: OAuthConfig
  // The Slack app's public address.
  publicUrl: string
  secret: string
  links: LinkStore
  // The organization the workspace is installed for.
  installationOrg(teamId: string): Promise<string | undefined>
  fetch?: typeof fetch
  now?: () => number
}

export type PageResult =
  { status: 302; redirect: string } | { status: number; html: string }

// The link the bot puts in front of a Slack user. Only the bot can make one, so a user cannot
// connect their account to somebody else's Slack identity.
export function connectLink(
  deps: Pick<ConnectDeps, 'publicUrl' | 'secret' | 'now'>,
  teamId: string,
  slackUserId: string
): string {
  const invite: Invite = { purpose: 'invite', teamId, slackUserId }
  const token = seal(invite, deps.secret, INVITE_TTL_MS, deps.now?.())
  return `${deps.publicUrl.replace(/\/$/, '')}/uigraph/connect?invite=${token}`
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)
}

function page(status: number, title: string, message: string): PageResult {
  return {
    status,
    html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body>`,
  }
}

export async function handleConnect(
  deps: ConnectDeps,
  invite: string | undefined
): Promise<PageResult> {
  const payload = invite
    ? unseal<Invite>(invite, deps.secret, deps.now?.())
    : undefined
  if (payload?.purpose !== 'invite') {
    return page(
      400,
      'This link has expired',
      'Mention the UIGraph app in Slack again to get a new connect link.'
    )
  }
  const orgId = await deps.installationOrg(payload.teamId)
  if (orgId === undefined) {
    return page(
      404,
      'Workspace not connected',
      'This Slack workspace is not connected to a UIGraph organization.'
    )
  }
  const { verifier, challenge } = pkce()
  const state: State = {
    purpose: 'state',
    teamId: payload.teamId,
    slackUserId: payload.slackUserId,
    verifier,
  }
  return {
    status: 302,
    redirect: buildAuthorizeUrl(deps.oauth, {
      state: seal(state, deps.secret, STATE_TTL_MS, deps.now?.()),
      challenge,
      orgId,
    }),
  }
}

export async function handleCallback(
  deps: ConnectDeps,
  query: { code?: string; state?: string; error?: string }
): Promise<PageResult> {
  const state = query.state
    ? unseal<State>(query.state, deps.secret, deps.now?.())
    : undefined
  if (state?.purpose !== 'state') {
    return page(
      400,
      'This link has expired',
      'Mention the UIGraph app in Slack again to get a new connect link.'
    )
  }
  if (query.error) {
    return page(
      403,
      'Not connected',
      'Access was not approved, so the Slack app can’t act for you. Mention it again in Slack to retry.'
    )
  }
  if (!query.code) {
    return page(400, 'Not connected', 'The approval did not include a code.')
  }

  const orgId = await deps.installationOrg(state.teamId)
  if (orgId === undefined) {
    return page(
      404,
      'Workspace not connected',
      'This Slack workspace is not connected to a UIGraph organization.'
    )
  }
  const tokens = await exchangeCode(
    deps.oauth,
    query.code,
    state.verifier,
    deps.fetch,
    deps.now?.()
  )
  const identity = await whoAmI(deps.oauth, tokens.accessToken, deps.fetch)
  // The grant has to be for the organization this workspace is installed for. The consent page
  // lets a person pick any of theirs, and the hint only preselects.
  if (identity.orgId !== orgId) {
    return page(
      403,
      'Wrong organization',
      'You approved access for a different UIGraph organization than the one this Slack workspace is connected to. Mention the app in Slack and try again, choosing the right organization. You can remove the other approval under Connected applications in UIGraph.'
    )
  }
  await deps.links.put(state.teamId, state.slackUserId, {
    orgId: identity.orgId,
    userId: identity.userId,
    refreshToken: tokens.refreshToken,
  })
  return page(
    200,
    'Connected',
    'Your UIGraph account is connected. Go back to Slack and ask again.'
  )
}
