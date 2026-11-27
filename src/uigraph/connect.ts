import {
  buildAuthorizeUrl,
  exchangeCode,
  InvalidGrantError,
  orgName,
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
  // The bot's Slack user in the workspace, so "Open Slack" can open the DM with it.
  botUserId?(teamId: string): Promise<string | undefined>
  // Posts in the Slack user's DM with the bot once they are connected. Failures are ignored.
  notifyConnected?(
    teamId: string,
    slackUserId: string,
    text: string
  ): Promise<void>
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

type PageOptions = {
  tone?: 'ok' | 'error'
  // Lines of "label: value" shown under the message.
  details?: Array<[string, string]>
  // An "Open Slack" button to this deep link.
  slackUrl?: string
}

// The UIGraph mark, inline so the page needs nothing but itself.
const LOGO = `<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#4f46e5"/><circle cx="10" cy="11" r="3" fill="#fff"/><circle cx="22" cy="11" r="3" fill="#fff"/><circle cx="16" cy="22" r="3" fill="#fff"/><path d="M10 11 16 22 22 11" stroke="#fff" stroke-width="1.6" fill="none"/></svg>`

const STYLE = `
:root{--bg:#f6f7fb;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#4f46e5;--accent-text:#fff;--ok:#059669;--err:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--card:#151821;--text:#f3f4f6;--muted:#9ca3af;--line:#262a36;--accent:#6366f1;--ok:#34d399;--err:#f87171}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:-.01em;margin-bottom:22px}
.status{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;margin-bottom:6px}
.ok .status{color:var(--ok)}.error .status{color:var(--err)}
h1{font-size:20px;line-height:1.3;margin:0 0 8px}
p{margin:0 0 16px;color:var(--muted)}
dl{margin:0 0 20px;border-top:1px solid var(--line)}
dl div{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--line)}
dt{color:var(--muted)}dd{margin:0;font-weight:500;text-align:right;overflow-wrap:anywhere}
.button{display:inline-block;background:var(--accent);color:var(--accent-text);text-decoration:none;font-weight:600;padding:10px 16px;border-radius:8px}
.button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
`

export function page(
  status: number,
  title: string,
  message: string,
  options: PageOptions = {}
): PageResult {
  const tone = options.tone ?? (status < 400 ? 'ok' : 'error')
  const details = options.details?.length
    ? `<dl>${options.details
        .map(
          ([label, value]) =>
            `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
        )
        .join('')}</dl>`
    : ''
  const button = options.slackUrl
    ? `<a class="button" href="${escapeHtml(options.slackUrl)}">Open Slack</a>`
    : ''
  return {
    status,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} · UIGraph</title><style>${STYLE}</style></head><body><main class="${tone}"><div class="brand">${LOGO}<span>UIGraph</span></div><div class="status">${tone === 'ok' ? '&#10003; Connected' : '&#9888; Action needed'}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${details}${button}</main></body></html>`,
  }
}

// Opens the DM with the bot when its user is known, or the workspace otherwise.
export function slackDeepLink(teamId: string, botUserId?: string): string {
  const team = encodeURIComponent(teamId)
  return botUserId
    ? `slack://user?team=${team}&id=${encodeURIComponent(botUserId)}`
    : `slack://open?team=${team}`
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
  const result = await callback(deps, query)
  // Every outcome of the callback strips the one-time code and state from the address bar.
  return 'html' in result
    ? { ...result, html: result.html.replace('</title>', '</title>' + SCRUB) }
    : result
}

const SCRUB = '<script>history.replaceState(null,"",location.pathname)</script>'

const EXPIRED = [
  'This link has expired',
  'Connect links work once and for a short time. Send the UIGraph app a message in Slack to get a new one.',
] as const

async function callback(
  deps: ConnectDeps,
  query: { code?: string; state?: string; error?: string }
): Promise<PageResult> {
  const state = query.state
    ? unseal<State>(query.state, deps.secret, deps.now?.())
    : undefined
  if (state?.purpose !== 'state') {
    return page(400, ...EXPIRED)
  }
  const botUserId = await deps.botUserId?.(state.teamId).catch(() => undefined)
  const slackUrl = slackDeepLink(state.teamId, botUserId)
  if (query.error) {
    return page(
      403,
      'Access was not approved',
      'Without your approval the Slack app can’t act as you. Send the UIGraph app a message in Slack to try again.',
      { slackUrl }
    )
  }
  if (!query.code) {
    return page(
      400,
      'Something was missing',
      'The approval did not include a code. Send the UIGraph app a message in Slack to try again.',
      { slackUrl }
    )
  }

  const orgId = await deps.installationOrg(state.teamId)
  if (orgId === undefined) {
    return page(
      404,
      'Workspace not connected',
      'This Slack workspace is not connected to a UIGraph organization. An admin can connect it under Settings → Integrations in UIGraph.'
    )
  }
  let tokens
  try {
    tokens = await exchangeCode(
      deps.oauth,
      query.code,
      state.verifier,
      deps.fetch,
      deps.now?.()
    )
  } catch (error) {
    // The code is single use: a reload or a second tab lands here.
    if (error instanceof InvalidGrantError) {
      return page(
        400,
        'This link was already used',
        'If you just connected, you’re done: go back to Slack. Otherwise send the UIGraph app a message to get a new link.',
        { slackUrl }
      )
    }
    throw error
  }
  const identity = await whoAmI(deps.oauth, tokens.accessToken, deps.fetch)
  // The grant has to be for the organization this workspace is installed for. The consent page
  // lets a person pick any of theirs, and the hint only preselects.
  if (identity.orgId !== orgId) {
    return page(
      403,
      'Wrong organization',
      'You approved access for a different UIGraph organization than the one this Slack workspace is connected to. Send the UIGraph app a message in Slack and try again, choosing the right organization. You can remove the other approval under Connected applications in UIGraph.',
      { slackUrl }
    )
  }
  const org = await orgName(
    deps.oauth,
    tokens.accessToken,
    identity.orgId,
    deps.fetch
  )
  // A Slack account that pointed at another UIGraph user is switched over; say so on the page.
  const previous = await deps.links
    .get(state.teamId, state.slackUserId)
    .catch(() => undefined)
  const switched = previous !== undefined && previous.userId !== identity.userId
  await deps.links.put(state.teamId, state.slackUserId, {
    orgId: identity.orgId,
    userId: identity.userId,
    refreshToken: tokens.refreshToken,
  })
  const who = identity.name ?? 'your UIGraph account'
  const where = org ? ` in ${org}` : ''
  if (deps.notifyConnected) {
    await deps
      .notifyConnected(
        state.teamId,
        state.slackUserId,
        `You're connected to UIGraph as ${who}${where}. Ask me anything here.`
      )
      // The link is stored; the notice is a nicety, and the caller logs its own failures.
      .catch(() => {})
  }
  const details: Array<[string, string]> = []
  if (identity.name) details.push(['UIGraph account', identity.name])
  if (org) details.push(['Organization', org])
  const switchedNote = switched
    ? ' This Slack account was linked to a different UIGraph account before; it now uses this one.'
    : ''
  return page(
    200,
    'You’re connected',
    `Slack now answers as you, with your UIGraph access. Go back to Slack to carry on.${switchedNote}`,
    { details, slackUrl }
  )
}
