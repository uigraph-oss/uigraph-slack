import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'

// Sealed values go in URLs (the connect link, the OAuth `state`), so they are encrypted and
// authenticated, not just signed: the PKCE verifier rides in the state and must stay secret.
// Each carries its own expiry.

const LABEL = 'uigraph-slack-sealed:'

function key(secret: string): Buffer {
  return createHash('sha256')
    .update(LABEL + secret)
    .digest()
}

export function seal(
  payload: Record<string, unknown>,
  secret: string,
  ttlMs: number,
  now = Date.now()
): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ ...payload, exp: now + ttlMs }), 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

export function unseal<T extends Record<string, unknown>>(
  token: string,
  secret: string,
  now = Date.now()
): T | undefined {
  try {
    const raw = Buffer.from(token, 'base64url')
    if (raw.length < 29) {
      return undefined
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(secret),
      raw.subarray(0, 12)
    )
    decipher.setAuthTag(raw.subarray(12, 28))
    const json = Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString('utf8')
    const payload = JSON.parse(json) as T & { exp?: number }
    if (typeof payload.exp !== 'number' || payload.exp < now) {
      return undefined
    }
    return payload
  } catch {
    return undefined
  }
}
