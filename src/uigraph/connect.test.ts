import { describe, expect, it } from 'vitest'
import {
  connectLink,
  handleCallback,
  handleConnect,
  type ConnectDeps,
} from './connect'
import type { OAuthConfig } from './oauth'
import { seal } from './seal'
import type { LinkStore } from './user-links'

const oauth: OAuthConfig = {
  apiUrl: 'http://api',
  clientId: 'c',
  redirectUri: 'https://app/uigraph/callback',
  resource: 'https://mcp/mcp',
  authorizeUrl: 'https://ui/oauth/consent',
}

function deps(overrides: Partial<ConnectDeps> = {}) {
  const saved: Record<string, unknown> = {}
  const links = {
    async get(t: string, u: string) {
      return saved[`${t}/${u}`]
    },
    async put(t: string, u: string, link: unknown) {
      saved[`${t}/${u}`] = link
    },
  } as unknown as LinkStore
  const base: ConnectDeps = {
    oauth,
    publicUrl: 'https://app',
    secret: 'a-long-enough-secret',
    links,
    installationOrg: async (team) => (team === 'T1' ? 'org-1' : undefined),
    fetch: (async (url: string) => {
      if (String(url).endsWith('/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'uig_oat_1',
            refresh_token: 'uig_ort_1',
            expires_in: 900,
          })
        )
      }
      if (String(url).endsWith('/api/v1/auth/orgs')) {
        return new Response(
          JSON.stringify({ orgs: [{ id: 'org-1', name: 'Acme <Eng>' }] })
        )
      }
      return new Response(
        JSON.stringify({
          userId: 'u1',
          orgId: 'org-1',
          resource: oauth.resource,
          name: 'Ana Lima',
        })
      )
    }) as unknown as typeof fetch,
  }
  return { deps: { ...base, ...overrides }, saved }
}

function invite(d: ConnectDeps, team = 'T1', user = 'U1') {
  return new URL(connectLink(d, team, user)).searchParams.get('invite')!
}

describe('connect flow', () => {
  it('turns an invite into a redirect to the consent page with PKCE and the org hint', async () => {
    const { deps: d } = deps()
    const result = await handleConnect(d, invite(d))
    expect(result.status).toBe(302)
    const url = new URL((result as { redirect: string }).redirect)
    expect(url.origin + url.pathname).toBe(oauth.authorizeUrl)
    expect(url.searchParams.get('org_id')).toBe('org-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    // The verifier is sealed in the state, never in the URL.
    const verifierLeak = url.search.includes('verifier')
    expect(verifierLeak).toBe(false)
  })

  it('refuses an invite that is forged, expired or for a workspace that is not connected', async () => {
    const { deps: d } = deps()
    expect((await handleConnect(d, 'nope')).status).toBe(400)
    expect((await handleConnect(d, undefined)).status).toBe(400)
    const forged = seal(
      { purpose: 'invite', teamId: 'T1', slackUserId: 'U1' },
      'another-secret-entirely',
      1000
    )
    expect((await handleConnect(d, forged)).status).toBe(400)
    expect((await handleConnect(d, invite(d, 'T9'))).status).toBe(404)
  })

  async function callbackFor(d: ConnectDeps, overrides = {}) {
    const redirect = (await handleConnect(d, invite(d))) as { redirect: string }
    const state = new URL(redirect.redirect).searchParams.get('state')!
    return handleCallback(d, { code: 'the-code', state, ...overrides })
  }

  it('stores the link for the Slack user once the org matches', async () => {
    const { deps: d, saved } = deps()
    const result = await callbackFor(d)
    expect(result.status).toBe(200)
    expect(saved['T1/U1']).toEqual({
      orgId: 'org-1',
      userId: 'u1',
      refreshToken: 'uig_ort_1',
    })
  })

  it('stores nothing when the grant is for another organization', async () => {
    const { deps: d, saved } = deps({
      fetch: (async (url: string) =>
        String(url).endsWith('/oauth/token')
          ? new Response(
              JSON.stringify({
                access_token: 'a',
                refresh_token: 'r',
                expires_in: 900,
              })
            )
          : new Response(
              JSON.stringify({ userId: 'u1', orgId: 'org-OTHER' })
            )) as unknown as typeof fetch,
    })
    const result = await callbackFor(d)
    expect(result.status).toBe(403)
    expect(saved).toEqual({})
  })

  it('stores nothing when approval is denied or the state is forged', async () => {
    const { deps: d, saved } = deps()
    expect((await callbackFor(d, { error: 'access_denied' })).status).toBe(403)
    expect(
      (await handleCallback(d, { code: 'c', state: 'forged' })).status
    ).toBe(400)
    // An invite cannot stand in for a state.
    expect(
      (await handleCallback(d, { code: 'c', state: invite(d) })).status
    ).toBe(400)
    expect(saved).toEqual({})
  })

  it('does not echo attacker-controlled text into the page', async () => {
    const { deps: d } = deps()
    const result = await callbackFor(d, { error: '<script>alert(1)</script>' })
    expect('html' in result && result.html).not.toContain('<script>alert')
  })
})

describe('connect page', () => {
  async function connected(overrides: Partial<ConnectDeps> = {}) {
    const notices: string[] = []
    const { deps: d, saved } = deps({
      botUserId: async () => 'B1',
      notifyConnected: async (team, user, text) => {
        notices.push(`${team}/${user}: ${text}`)
      },
      ...overrides,
    })
    const redirect = (await handleConnect(d, invite(d))) as { redirect: string }
    const state = new URL(redirect.redirect).searchParams.get('state')!
    const result = await handleCallback(d, { code: 'the-code', state })
    return {
      result,
      html: 'html' in result ? result.html : '',
      notices,
      saved,
      d,
      state,
    }
  }

  it('says who and which org was linked, escaped, with an Open Slack button to the bot DM', async () => {
    const { result, html } = await connected()
    expect(result.status).toBe(200)
    expect(html).toContain('UIGraph')
    expect(html).toContain('You’re connected')
    expect(html).toContain('Ana Lima')
    expect(html).toContain('Acme &lt;Eng&gt;')
    expect(html).not.toContain('Acme <Eng>')
    expect(html).toContain('href="slack://user?team=T1&amp;id=B1"')
    expect(html).toContain('>Open Slack</a>')
    // Nothing is loaded from elsewhere.
    expect(html).not.toMatch(/(src|href)="https?:/)
  })

  it('removes the code and state from the address bar on every outcome', async () => {
    const { html } = await connected()
    expect(html).toContain('history.replaceState(null,"",location.pathname)')
    const { deps: d } = deps()
    const expired = await handleCallback(d, { code: 'c', state: 'forged' })
    expect('html' in expired && expired.html).toContain('history.replaceState')
  })

  it('opens the workspace when the bot user is unknown', async () => {
    const { html } = await connected({ botUserId: async () => undefined })
    expect(html).toContain('href="slack://open?team=T1"')
  })

  it("posts You're connected in the user's DM", async () => {
    const { notices } = await connected()
    expect(notices).toEqual([
      "T1/U1: You're connected to UIGraph as Ana Lima in Acme <Eng>. Ask me anything here.",
    ])
  })

  it('still connects when the Slack notice fails', async () => {
    const { result, saved } = await connected({
      notifyConnected: async () => {
        throw new Error('slack down')
      },
    })
    expect(result.status).toBe(200)
    expect(saved['T1/U1']).toBeDefined()
  })

  it('says when the Slack account switched from another UIGraph account', async () => {
    const { deps: d, saved } = deps()
    saved['T1/U1'] = {
      orgId: 'org-1',
      userId: 'someone-else',
      refreshToken: 'r',
    }
    const redirect = (await handleConnect(d, invite(d))) as { redirect: string }
    const state = new URL(redirect.redirect).searchParams.get('state')!
    const result = await handleCallback(d, { code: 'the-code', state })
    expect('html' in result && result.html).toContain(
      'linked to a different UIGraph account before'
    )
  })

  it('explains an expired link', async () => {
    const { deps: d } = deps()
    const result = await handleCallback(d, { code: 'c', state: 'forged' })
    expect(result.status).toBe(400)
    expect('html' in result && result.html).toContain('This link has expired')
    expect('html' in result && result.html).toContain('get a new one')
  })

  it('explains a code that was already used', async () => {
    const { deps: d, saved } = deps({
      fetch: (async () =>
        new Response('{"error":"invalid_grant"}', {
          status: 400,
        })) as unknown as typeof fetch,
    })
    const redirect = (await handleConnect(d, invite(d))) as { redirect: string }
    const state = new URL(redirect.redirect).searchParams.get('state')!
    const result = await handleCallback(d, { code: 'used', state })
    expect(result.status).toBe(400)
    expect('html' in result && result.html).toContain(
      'This link was already used'
    )
    expect(saved).toEqual({})
  })

  it('explains the wrong organization with what to do next', async () => {
    const { deps: d } = deps({
      fetch: (async (url: string) =>
        String(url).endsWith('/oauth/token')
          ? new Response(
              JSON.stringify({
                access_token: 'a',
                refresh_token: 'r',
                expires_in: 900,
              })
            )
          : new Response(
              JSON.stringify({ userId: 'u1', orgId: 'org-OTHER' })
            )) as unknown as typeof fetch,
    })
    const redirect = (await handleConnect(d, invite(d))) as { redirect: string }
    const state = new URL(redirect.redirect).searchParams.get('state')!
    const result = await handleCallback(d, { code: 'c', state })
    expect(result.status).toBe(403)
    expect('html' in result && result.html).toContain('Wrong organization')
    expect('html' in result && result.html).toContain(
      'choosing the right organization'
    )
  })
})
