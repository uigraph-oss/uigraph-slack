import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildAuthorizeUrl,
  exchangeCode,
  InvalidGrantError,
  pkce,
  refreshTokens,
  whoAmI,
  type OAuthConfig,
} from './oauth'

const config: OAuthConfig = {
  apiUrl: 'http://api.internal',
  clientId: 'uig_client_1',
  redirectUri: 'https://slack.example/uigraph/callback',
  resource: 'https://mcp.example/mcp',
  authorizeUrl: 'https://uigraph.example/oauth/consent',
}

function reply(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

describe('oauth', () => {
  it('builds an S256 PKCE pair', () => {
    const { verifier, challenge } = pkce()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(challenge).toBe(
      createHash('sha256').update(verifier).digest('base64url')
    )
  })

  it('asks for the default scope and binds the grant to the MCP resource', () => {
    const url = new URL(
      buildAuthorizeUrl(config, {
        state: 'st',
        challenge: 'ch',
        orgId: 'org-1',
      })
    )
    expect(url.origin + url.pathname).toBe(config.authorizeUrl)
    expect(url.searchParams.get('resource')).toBe(config.resource)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri)
    expect(url.searchParams.get('org_id')).toBe('org-1')
    expect(url.searchParams.has('scope')).toBe(false)
  })

  it('exchanges a code and computes the expiry', async () => {
    let sent: URLSearchParams | undefined
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = init.body as URLSearchParams
      return new Response(
        JSON.stringify({
          access_token: 'uig_oat_a',
          refresh_token: 'uig_ort_a',
          expires_in: 900,
        })
      )
    }) as unknown as typeof fetch
    const tokens = await exchangeCode(config, 'code', 'ver', fetchImpl, 1000)
    expect(tokens).toEqual({
      accessToken: 'uig_oat_a',
      refreshToken: 'uig_ort_a',
      expiresAt: 1000 + 900_000,
    })
    expect(sent?.get('grant_type')).toBe('authorization_code')
    expect(sent?.get('code_verifier')).toBe('ver')
    expect(sent?.get('resource')).toBe(config.resource)
  })

  it('treats a refused refresh as a dead grant, not a transient error', async () => {
    await expect(
      refreshTokens(config, 'old', reply(400, { error: 'invalid_grant' }))
    ).rejects.toBeInstanceOf(InvalidGrantError)
    await expect(
      refreshTokens(config, 'old', reply(502, {}))
    ).rejects.not.toBeInstanceOf(InvalidGrantError)
  })

  it('reads who a token belongs to', async () => {
    const identity = await whoAmI(
      config,
      'tok',
      reply(200, { userId: 'u1', orgId: 'o1', resource: config.resource })
    )
    expect(identity).toEqual({
      userId: 'u1',
      orgId: 'o1',
      resource: config.resource,
    })
    await expect(whoAmI(config, 'tok', reply(200, {}))).rejects.toThrow()
  })
})
