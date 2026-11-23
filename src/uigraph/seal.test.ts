import { describe, expect, it } from 'vitest'
import { seal, unseal } from './seal'

describe('seal', () => {
  it('round-trips a payload', () => {
    const token = seal({ teamId: 'T1', verifier: 'secret-verifier' }, 's', 1000)
    expect(unseal(token, 's')).toMatchObject({
      teamId: 'T1',
      verifier: 'secret-verifier',
    })
  })

  it('does not reveal the payload in the token', () => {
    const token = seal({ verifier: 'secret-verifier' }, 's', 1000)
    expect(token).not.toContain('secret-verifier')
    expect(Buffer.from(token, 'base64url').toString('utf8')).not.toContain(
      'secret-verifier'
    )
  })

  it('refuses another secret, a changed token and an expired one', () => {
    const now = 1_000_000
    const token = seal({ a: 1 }, 's', 1000, now)
    expect(unseal(token, 'other', now)).toBeUndefined()
    const bytes = Buffer.from(token, 'base64url')
    bytes[bytes.length - 1] ^= 1
    expect(unseal(bytes.toString('base64url'), 's', now)).toBeUndefined()
    expect(unseal(token, 's', now + 1001)).toBeUndefined()
    expect(unseal(token, 's', now + 500)).toBeDefined()
  })

  it('refuses garbage', () => {
    expect(unseal('', 's')).toBeUndefined()
    expect(unseal('not a token', 's')).toBeUndefined()
  })
})
