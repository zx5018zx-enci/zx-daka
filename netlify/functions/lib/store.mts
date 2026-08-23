import { getStore } from '@netlify/blobs'
import { randomBytes } from 'node:crypto'

export type LogItem = { id: string; name: string; amount: string }
export type DayRecord = {
  weight: number | null
  exercises: LogItem[]
  foods: LogItem[]
  brushMorning: boolean
  brushEvening: boolean
}
export type Records = Record<string, DayRecord>

export type StoredUser = {
  id: string
  username: string
  displayName: string
  userCode: string
  salt: string
  passwordHash: string
  createdAt: string
}

export type PublicUser = Pick<StoredUser, 'id' | 'username' | 'displayName' | 'userCode'>

export const toPublicUser = (user: StoredUser): PublicUser => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  userCode: user.userCode,
})

const store = () => getStore({ name: 'zx-checkin', consistency: 'strong' })

export const readUserById = async (id: string): Promise<StoredUser | null> =>
  (await store().get(`users/${id}`, { type: 'json' })) as StoredUser | null

export const readUserByUsername = async (username: string): Promise<StoredUser | null> => {
  const index = (await store().get(`usernames/${username}`, { type: 'json' })) as { id?: unknown } | null
  if (typeof index?.id !== 'string') return null
  return readUserById(index.id)
}

export const readUserByCode = async (code: string): Promise<StoredUser | null> => {
  const index = (await store().get(`codes/${code}`, { type: 'json' })) as { id?: unknown } | null
  if (typeof index?.id !== 'string') return null
  return readUserById(index.id)
}

const reserveUsername = async (username: string, id: string): Promise<boolean> => {
  const result = await store().setJSON(`usernames/${username}`, { id }, { onlyIfNew: true })
  return result.modified === true
}

const reserveCode = async (code: string, id: string): Promise<boolean> => {
  const result = await store().setJSON(`codes/${code}`, { id }, { onlyIfNew: true })
  return result.modified === true
}

const USER_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export const createUser = async (user: StoredUser): Promise<StoredUser | null> => {
  if (!(await reserveUsername(user.username, user.id))) return null
  let code = ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    code = Array.from(
      { length: 8 },
      () => USER_CODE_ALPHABET[randomBytes(1)[0] % USER_CODE_ALPHABET.length],
    ).join('')
    if (await reserveCode(code, user.id)) break
    code = ''
  }
  if (!code) return null
  const created = { ...user, userCode: code }
  await store().setJSON(`users/${created.id}`, created)
  return created
}

export const readRecords = async (userId: string): Promise<Records> =>
  ((await store().get(`records/${userId}`, { type: 'json' })) as Records | null) ?? {}

export const writeRecords = async (userId: string, records: Records): Promise<void> => {
  await store().setJSON(`records/${userId}`, records)
}

export const readLimit = async (type: string, key: string): Promise<{ count: number; resetAt: number } | null> =>
  (await store().get(`limits/${type}/${key}`, { type: 'json' })) as { count: number; resetAt: number } | null

export const writeLimit = async (type: string, key: string, entry: { count: number; resetAt: number }): Promise<void> => {
  await store().setJSON(`limits/${type}/${key}`, entry)
}
