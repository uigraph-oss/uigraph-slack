import { createHash, randomBytes } from 'node:crypto'

// The Slack app is an OAuth client of UIGraph's own authorization server: a Slack user approves
// once, and the app then acts as that user, with that user's role, instead of as the workspace's
// service account.

export type OAuthConfig = {
  // Where the app reaches uigraph-api (it may differ from the public address).
  apiUrl: string
  clientId: string
  // The app's own public callback, registered with the client.
  redirectUri: string
  // The MCP server's public address, which the grant is bound to.
  resource: string
  // The consent page the user's browser opens.
  authorizeUrl: string
}

export type TokenSet = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

// The refresh token was refused: revoked, expired, or already used. The link is dead.
export class InvalidGrantError extends Error {
  constructor(message = 'The UIGraph grant is no longer valid') {
    super(message)
    this.name = 'InvalidGrantError'
  }
}

type Fetch = typeof fetch

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function buildAuthorizeUrl(
  config: OAuthConfig,
  params: { state: string; challenge: string; orgId: string }
): string {
  const url = new URL(config.authorizeUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('code_challenge', params.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('resource', config.resource)
  url.searchParams.set('state', params.state)
  // Only a hint for the consent page; the server and the callback decide.
  url.searchParams.set('org_id', params.orgId)
  return url.toString()
}

async function tokenRequest(
  config: OAuthConfig,
  form: Record<string, string>,
  fetchImpl: Fetch,
  now: number
): Promise<TokenSet> {
  const response = await fetchImpl(`${config.apiUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      resource: config.resource,
      ...form,
    }),
  })
  if (response.status === 400 || response.status === 401) {
    throw new InvalidGrantError()
  }
  if (!response.ok) {
    throw new Error(`UIGraph token request failed: status ${response.status}`)
  }
  const body = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!body.access_token || !body.refresh_token) {
    throw new Error('UIGraph token response is missing a token')
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now + (body.expires_in ?? 900) * 1000,
  }
}

export function exchangeCode(
  config: OAuthConfig,
  code: string,
  verifier: string,
  fetchImpl: Fetch = fetch,
  now = Date.now()
): Promise<TokenSet> {
  return tokenRequest(
    config,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    },
    fetchImpl,
    now
  )
}

export function refreshTokens(
  config: OAuthConfig,
  refreshToken: string,
  fetchImpl: Fetch = fetch,
  now = Date.now()
): Promise<TokenSet> {
  return tokenRequest(
    config,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    fetchImpl,
    now
  )
}

export type Identity = { userId: string; orgId: string; resource: string }

// Who the token belongs to, as the API sees it. The callback uses this to make sure the grant is
// for the organization the workspace is installed for.
export async function whoAmI(
  config: OAuthConfig,
  accessToken: string,
  fetchImpl: Fetch = fetch
): Promise<Identity> {
  const response = await fetchImpl(`${config.apiUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(`UIGraph identity lookup failed: status ${response.status}`)
  }
  const me = (await response.json()) as {
    userId?: string
    orgId?: string
    resource?: string
  }
  if (!me.userId || !me.orgId) {
    throw new Error('UIGraph identity response is missing the user or org')
  }
  return { userId: me.userId, orgId: me.orgId, resource: me.resource ?? '' }
}
