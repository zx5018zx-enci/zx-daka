import { createHash } from 'node:crypto'
import { readLimit, writeLimit } from './store.mts'

const WINDOW_MS = 15 * 60 * 1000

export const clientKey = (request: Request): string => {
  const ip =
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  return createHash('sha256').update(ip).digest('hex').slice(0, 24)
}

export const allowOrReject = async (type: 'login' | 'register' | 'profile', request: Request, max: number): Promise<boolean> => {
  const key = clientKey(request)
  const now = Date.now()
  const entry = await readLimit(type, key)
  if (!entry || entry.resetAt < now) {
    await writeLimit(type, key, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= max) return false
  await writeLimit(type, key, { count: entry.count + 1, resetAt: entry.resetAt })
  return true
}
