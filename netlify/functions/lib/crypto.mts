import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

export const generateSalt = (): string => randomBytes(16).toString('hex')

export const hashPassword = (password: string, salt: string): string =>
  scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')

export const verifyPassword = (password: string, salt: string, expectedHash: string): boolean => {
  const actual = Buffer.from(hashPassword(password, salt), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const b64url = (value: string | Buffer): string =>
  Buffer.from(value).toString('base64url')

const sessionSecret = (): string => process.env.SESSION_SECRET ?? ''

export type SessionData = { sub: string; username: string }

export const signSession = (userId: string, username: string): string => {
  const payload = b64url(JSON.stringify({ sub: userId, username, exp: Date.now() + SESSION_MAX_AGE_MS }))
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export const verifySession = (token: string | null): SessionData | null => {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = createHmac('sha256', sessionSecret()).update(payload).digest()
  let provided: Buffer
  try {
    provided = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      sub?: unknown
      username?: unknown
      exp?: unknown
    }
    if (typeof data.sub !== 'string' || typeof data.username !== 'string' || typeof data.exp !== 'number') {
      return null
    }
    if (data.exp < Date.now()) return null
    return { sub: data.sub, username: data.username }
  } catch {
    return null
  }
}

export const sessionCookie = (token: string, secure: boolean): string =>
  `zx_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE}${secure ? '; Secure' : ''}`

export const clearSessionCookie = (secure: boolean): string =>
  `zx_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`

export const readCookie = (request: Request, name: string): string | null => {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=').trim()
  }
  return null
}
