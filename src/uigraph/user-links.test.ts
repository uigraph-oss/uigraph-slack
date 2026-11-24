import { describe, expect, it } from 'vitest'
import type { OAuthConfig } from './oauth'
import {
  createUserTokens,
  NotConnectedError,
  type Link,
  type LinkStore,
} from './user-links'

const oauth: OAuthConfig = {
  apiUrl: 'http://api',
  clientId: 'c',
  redirectUri: 'https://app/cb',
  resource: 'https://mcp/mcp',
  authorizeUrl: 'https://ui/consent',
}

// An in-memory link store that behaves like the API's: one lease at a time, versioned rotation.
function memoryStore(initial?: Link) {
  let link = initial ? { ...initial } : undefined
  let leased = false
  const calls = { lease: 0, rotate: 0, delete: 0 }
  const store: LinkStore = {
    async get() {
      return link && { ...link }
    },
    async put() {},
    async lease() {
      calls.lease += 1
      if (!link) return undefined
      if (leased) return 'busy'
      leased = true
      return { ...link }
    },
    async rotate(_t, _u, version, refreshToken) {
      calls.rotate += 1
      if (!link || link.version !== version) return 'stale'
      link = { ...link, refreshToken, version: version + 1 }
      leased = false
      return 'ok'
    },
    async delete() {
      calls.delete += 1
      link = undefined
      leased = false
    },
  }
  return { store, calls, current: () => link }
}

// A token endpoint that, like the real one, rejects a refresh token it has already seen.
function tokenEndpoint() {
  const used = new Set<string>()
  let n = 0
  const requests: string[] = []
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const form = init.body as URLSearchParams
    const refresh = form.get('refresh_token') ?? ''
    requests.push(refresh)
    if (used.has(refresh) || !refresh.startsWith('uig_ort_')) {
      return new Response('{"error":"invalid_grant"}', { status: 400 })
    }
    used.add(refresh)
    n += 1
    return new Response(
      JSON.stringify({
        access_token: `uig_oat_${n}`,
        refresh_token: `uig_ort_${n + 1}`,
        expires_in: 900,
      })
    )
  }) as unknown as typeof fetch
  return { fetchImpl, requests }
}

const link: Link = {
  orgId: 'o1',
  userId: 'u1',
  refreshToken: 'uig_ort_1',
  version: 1,
}

describe('createUserTokens', () => {
  it('refreshes once and serves later calls from the cache', async () => {
    const { store, calls } = memoryStore(link)
    const { fetchImpl, requests } = tokenEndpoint()
    const tokens = createUserTokens({ links: store, oauth, fetch: fetchImpl })
    const a = await tokens.getAccess('T1', 'U1')
    const b = await tokens.getAccess('T1', 'U1')
    expect(a.accessToken).toBe('uig_oat_1')
    expect(a.orgId).toBe('o1')
    expect(b).toBe(a)
    expect(requests).toEqual(['uig_ort_1'])
    expect(calls.rotate).toBe(1)
  })

  it('never uses a refresh token twice when requests overlap', async () => {
    const { store } = memoryStore(link)
    const { fetchImpl, requests } = tokenEndpoint()
    const tokens = createUserTokens({
      links: store,
      oauth,
      fetch: fetchImpl,
      sleep: async () => {},
    })
    const results = await Promise.all(
      Array.from({ length: 8 }, () => tokens.getAccess('T1', 'U1'))
    )
    expect(new Set(requests).size).toBe(requests.length)
    expect(results.every((r) => r.accessToken.startsWith('uig_oat_'))).toBe(
      true
    )
  })

  it('waits for another replica holding the lease, then uses the rotated token', async () => {
    const { store, calls } = memoryStore(link)
    const { fetchImpl, requests } = tokenEndpoint()
    // Another replica holds the lease for two checks, then finishes and rotates.
    let busyChecks = 2
    const other: LinkStore = {
      ...store,
      async lease(t, u) {
        if (busyChecks > 0) {
          busyChecks -= 1
          if (busyChecks === 0) await store.rotate(t, u, 1, 'uig_ort_2')
          return 'busy'
        }
        return store.lease(t, u)
      },
    }
    const tokens = createUserTokens({
      links: other,
      oauth,
      fetch: fetchImpl,
      sleep: async () => {},
    })
    const access = await tokens.getAccess('T1', 'U1')
    expect(access.accessToken).toBe('uig_oat_1')
    expect(requests).toEqual(['uig_ort_2'])
    expect(calls.rotate).toBe(2)
  })

  it('treats a missing link as not connected', async () => {
    const { store } = memoryStore(undefined)
    const tokens = createUserTokens({ links: store, oauth })
    await expect(tokens.getAccess('T1', 'U1')).rejects.toBeInstanceOf(
      NotConnectedError
    )
  })

  it('drops the link and asks to reconnect when the grant was revoked', async () => {
    const { store, calls, current } = memoryStore({
      ...link,
      refreshToken: 'revoked',
    })
    const { fetchImpl } = tokenEndpoint()
    const tokens = createUserTokens({ links: store, oauth, fetch: fetchImpl })
    await expect(tokens.getAccess('T1', 'U1')).rejects.toBeInstanceOf(
      NotConnectedError
    )
    expect(calls.delete).toBe(1)
    expect(current()).toBeUndefined()
  })

  it('refreshes again when the access token is about to expire', async () => {
    const { store } = memoryStore(link)
    const { fetchImpl, requests } = tokenEndpoint()
    let clock = 0
    const tokens = createUserTokens({
      links: store,
      oauth,
      fetch: fetchImpl,
      now: () => clock,
    })
    await tokens.getAccess('T1', 'U1')
    clock = 900_000 - 30_000
    const next = await tokens.getAccess('T1', 'U1')
    expect(next.accessToken).toBe('uig_oat_2')
    expect(requests).toEqual(['uig_ort_1', 'uig_ort_2'])
  })
})
