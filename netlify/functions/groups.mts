import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

type CurrentUser = {
  id: string
  userCode: string
}

type StoredUser = {
  id: string
  displayName: string
  userCode: string
}

type DayRecord = {
  weight?: number | null
  exercises?: unknown[]
  foods?: unknown[]
  brushMorning?: boolean
  brushEvening?: boolean
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

const isCheckedIn = (record?: DayRecord) =>
  Boolean(
    record &&
      (record.weight != null ||
        (Array.isArray(record.exercises) && record.exercises.length > 0) ||
        (Array.isArray(record.foods) && record.foods.length > 0) ||
        record.brushMorning ||
        record.brushEvening),
  )

const authenticate = async (request: Request): Promise<CurrentUser | null> => {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null

  const response = await fetch(new URL('/api/auth/me', request.url), {
    headers: { accept: 'application/json', cookie },
  })
  if (!response.ok) return null

  const body = (await response.json()) as { user?: Partial<CurrentUser> }
  return typeof body.user?.id === 'string' && typeof body.user.userCode === 'string'
    ? { id: body.user.id, userCode: body.user.userCode }
    : null
}

const parseDate = (request: Request) => {
  const value = new URL(request.url).searchParams.get('date') ?? ''
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : new Date().toISOString().slice(0, 10)
}

const readMembers = async (codes: string[], date: string) => {
  const store = getStore({ name: 'zx-checkin', consistency: 'strong' })
  const members = await Promise.all(
    codes.map(async (userCode) => {
      const codeIndex = await store.get(`codes/${userCode}`, { type: 'json' }) as { id?: unknown } | null
      if (typeof codeIndex?.id !== 'string') return null

      const [profile, records] = await Promise.all([
        store.get(`users/${codeIndex.id}`, { type: 'json' }) as Promise<StoredUser | null>,
        store.get(`records/${codeIndex.id}`, { type: 'json' }) as Promise<Record<string, DayRecord> | null>,
      ])
      if (!profile) return null
      return {
        displayName: profile.displayName,
        userCode: profile.userCode,
        checked: isCheckedIn(records?.[date]),
      }
    }),
  )
  return members.filter((member): member is NonNullable<typeof member> => member !== null)
}

export default async (request: Request, _context: Context) => {
  const user = await authenticate(request).catch(() => null)
  if (!user) return json({ error: '请先登录' }, 401)

  const store = getStore({ name: 'zx-checkin', consistency: 'strong' })
  const key = `links/${user.id}`
  const date = parseDate(request)

  if (request.method === 'GET') {
    const saved = await store.get(key, { type: 'json' }) as { codes?: unknown } | null
    const codes = Array.isArray(saved?.codes)
      ? saved.codes.filter((code): code is string => typeof code === 'string')
      : []
    return json({ members: await readMembers(codes, date) })
  }

  if (request.method === 'PUT') {
    const body = await request.json().catch(() => null) as { codes?: unknown } | null
    if (!Array.isArray(body?.codes)) return json({ error: '关联用户格式不正确' }, 400)

    const codes = [...new Set(body.codes
      .filter((code): code is string => typeof code === 'string')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => /^[A-Z0-9]{8}$/.test(code) && code !== user.userCode))]
      .slice(0, 12)

    const members = await readMembers(codes, date)
    await store.setJSON(key, {
      codes: members.map((member) => member.userCode),
      updatedAt: new Date().toISOString(),
    })
    return json({ members })
  }

  return json({ error: 'Method not allowed' }, 405)
}

export const config: Config = {
  path: '/api/groups',
  method: ['GET', 'PUT'],
}
