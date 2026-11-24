import { InvalidGrantError, refreshTokens, type OAuthConfig } from './oauth'

// A Slack user who has not connected their UIGraph account, or whose grant is gone.
export class NotConnectedError extends Error {
  constructor() {
    super('This Slack user has not connected a UIGraph account')
    this.name = 'NotConnectedError'
  }
}

export type Link = {
  orgId: string
  userId: string
  refreshToken: string
  version: number
}

// The link store: uigraph-api keeps each Slack user's refresh token, encrypted.
export type LinkStore = {
  get(teamId: string, slackUserId: string): Promise<Link | undefined>
  put(
    teamId: string,
    slackUserId: string,
    link: { orgId: string; userId: string; refreshToken: string }
  ): Promise<void>
  // Reserves the link so one replica rotates its token. 'busy' while another holds it.
  lease(teamId: string, slackUserId: string): Promise<Link | 'busy' | undefined>
  // 'stale' when the link changed since it was leased.
  rotate(
    teamId: string,
    slackUserId: string,
    version: number,
    refreshToken: string
  ): Promise<'ok' | 'stale'>
  delete(teamId: string, slackUserId: string): Promise<void>
}

export function createLinkStore(
  apiUrl: string,
  internalToken: string,
  fetchImpl: typeof fetch = fetch
): LinkStore {
  function url(teamId: string, slackUserId: string, suffix = ''): string {
    return `${apiUrl}/internal/v1/slack-app/links/${encodeURIComponent(teamId)}/${encodeURIComponent(slackUserId)}${suffix}`
  }
  function call(
    method: string,
    target: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    return fetchImpl(target, {
      method,
      headers: {
        'X-Internal-Token': internalToken,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  }
  function fail(what: string, status: number): Error {
    return new Error(`UIGraph link ${what} failed: status ${status}`)
  }

  return {
    async get(teamId, slackUserId) {
      const response = await call('GET', url(teamId, slackUserId))
      if (response.status === 404) return undefined
      if (!response.ok) throw fail('lookup', response.status)
      return (await response.json()) as Link
    },
    async put(teamId, slackUserId, link) {
      const response = await call('PUT', url(teamId, slackUserId), link)
      if (!response.ok) throw fail('save', response.status)
    },
    async lease(teamId, slackUserId) {
      const response = await call('POST', url(teamId, slackUserId, '/lease'))
      if (response.status === 404) return undefined
      if (response.status === 409) return 'busy'
      if (!response.ok) throw fail('lease', response.status)
      return (await response.json()) as Link
    },
    async rotate(teamId, slackUserId, version, refreshToken) {
      const response = await call('POST', url(teamId, slackUserId, '/rotate'), {
        version,
        refreshToken,
      })
      if (response.status === 409) return 'stale'
      if (!response.ok) throw fail('rotate', response.status)
      return 'ok'
    },
    async delete(teamId, slackUserId) {
      const response = await call('DELETE', url(teamId, slackUserId))
      if (!response.ok && response.status !== 404) {
        throw fail('delete', response.status)
      }
    },
  }
}

export type UserAccess = {
  accessToken: string
  orgId: string
  expiresAt: number
}

type Deps = {
  links: LinkStore
  oauth: OAuthConfig
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const EARLY_MS = 60_000
const BUSY_WAIT_MS = 250
const BUSY_ATTEMPTS = 40

// Hands out access tokens for a Slack user. Access tokens are short, and each refresh token is
// single use (using one twice revokes the whole grant), so a refresh runs one at a time: in this
// process through a per-user chain, and across replicas through the link's lease.
export function createUserTokens(deps: Deps) {
  const now = deps.now ?? (() => Date.now())
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const cache = new Map<string, UserAccess>()
  const chains = new Map<string, Promise<unknown>>()

  async function refresh(
    teamId: string,
    slackUserId: string
  ): Promise<UserAccess> {
    const key = `${teamId}:${slackUserId}`
    for (let attempt = 0; attempt < BUSY_ATTEMPTS; attempt += 1) {
      const cached = cache.get(key)
      if (cached && cached.expiresAt - now() > EARLY_MS) return cached

      const link = await deps.links.lease(teamId, slackUserId)
      if (link === undefined) {
        cache.delete(key)
        throw new NotConnectedError()
      }
      if (link === 'busy') {
        await sleep(BUSY_WAIT_MS)
        continue
      }

      let tokens
      try {
        tokens = await refreshTokens(
          deps.oauth,
          link.refreshToken,
          deps.fetch,
          now()
        )
      } catch (error) {
        if (error instanceof InvalidGrantError) {
          cache.delete(key)
          await deps.links.delete(teamId, slackUserId)
          throw new NotConnectedError()
        }
        throw error
      }
      const stored = await deps.links.rotate(
        teamId,
        slackUserId,
        link.version,
        tokens.refreshToken
      )
      const access = {
        accessToken: tokens.accessToken,
        orgId: link.orgId,
        expiresAt: tokens.expiresAt,
      }
      // 'stale': the user reconnected while this ran. The new link wins, so do not keep a token
      // from the old grant; use it for this request only.
      if (stored === 'ok') cache.set(key, access)
      return access
    }
    throw new Error('Timed out waiting to refresh the UIGraph token')
  }

  return {
    getAccess(teamId: string, slackUserId: string): Promise<UserAccess> {
      const key = `${teamId}:${slackUserId}`
      const cached = cache.get(key)
      if (cached && cached.expiresAt - now() > EARLY_MS) {
        return Promise.resolve(cached)
      }
      const previous = chains.get(key) ?? Promise.resolve()
      const next = previous
        .catch(() => undefined)
        .then(() => refresh(teamId, slackUserId))
      chains.set(key, next)
      void next
        .finally(() => {
          if (chains.get(key) === next) chains.delete(key)
        })
        .catch(() => undefined)
      return next
    },
    forget(teamId: string, slackUserId: string): void {
      cache.delete(`${teamId}:${slackUserId}`)
    },
  }
}
