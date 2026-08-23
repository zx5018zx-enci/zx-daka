import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import { requireUser } from './lib/auth.mts'
import {
  DayRecord,
  readRecords,
  readUserByCode,
  Records,
  StoredUser,
} from './lib/store.mts'

type GroupMember = {
  displayName: string
  userCode: string
  checked: boolean
}

type LinkEntry = {
  codes?: unknown
  updatedAt?: unknown
}

type RelationshipPeriod = {
  startedOn: string
  endedOn?: string
}

type RelationshipHistory = {
  periods: RelationshipPeriod[]
}

const STORE_NAME = 'zx-checkin'
const MAX_MEMBERS = 12
const RECIPROCAL_MIGRATION = 'reciprocal-v1'

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

const isCheckedIn = (record?: DayRecord) =>
  Boolean(
    record &&
      (record.weight != null ||
        record.exercises.length > 0 ||
        record.foods.length > 0 ||
        (Array.isArray(record.drinks) && record.drinks.length > 0) ||
        record.brushMorning ||
        record.brushEvening),
  )

const normalizeCodes = (codes: unknown, ownCode?: string): string[] =>
  Array.isArray(codes)
    ? [...new Set(
        codes
          .filter((code): code is string => typeof code === 'string')
          .map((code) => code.trim().toUpperCase())
          .filter((code) => /^[A-Z0-9]{8}$/.test(code) && code !== ownCode),
      )].slice(0, MAX_MEMBERS)
    : []

const parseDate = (request: Request) => {
  const value = new URL(request.url).searchParams.get('date') ?? ''
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : new Date().toISOString().slice(0, 10)
}

const linkKey = (userId: string) => `links/${userId}`

const relationshipKey = (firstUserId: string, secondUserId: string) =>
  `relationship-history/${[firstUserId, secondUserId].sort().join('--')}`

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

const sanitizeHistory = (value: unknown): RelationshipHistory => {
  const periods = value && typeof value === 'object' && Array.isArray((value as RelationshipHistory).periods)
    ? (value as RelationshipHistory).periods.filter(
        (period): period is RelationshipPeriod =>
          Boolean(period && isDate(period.startedOn) && (!period.endedOn || isDate(period.endedOn))),
      )
    : []
  return { periods }
}

const readLinkEntry = async (userId: string): Promise<LinkEntry> => {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })
  return (await store.get(linkKey(userId), { type: 'json' }) as LinkEntry | null) ?? {}
}

const readCodes = async (userId: string, ownCode?: string): Promise<string[]> => {
  const saved = await readLinkEntry(userId)
  return normalizeCodes(saved.codes, ownCode)
}

const sameCodes = (left: string[], right: string[]) =>
  left.length === right.length && left.every((code, index) => code === right[index])

const updateCodes = async (
  userId: string,
  updater: (codes: string[]) => string[],
  ownCode?: string,
): Promise<string[]> => {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })
  const key = linkKey(userId)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const saved = await store.getWithMetadata(key, { type: 'json' }) as {
      data: LinkEntry
      etag?: string
    } | null
    const current = normalizeCodes(saved?.data.codes, ownCode)
    const next = normalizeCodes(updater(current), ownCode)
    if (sameCodes(current, next)) return current

    const options = saved?.etag
      ? { onlyIfMatch: saved.etag }
      : saved
        ? undefined
        : { onlyIfNew: true as const }
    const write = await store.setJSON(key, {
      codes: next,
      updatedAt: new Date().toISOString(),
    }, options)
    if (write.modified) return next
  }

  throw new Error('关联关系同步失败，请重试')
}

const updateRelationshipHistory = async (
  firstUserId: string,
  secondUserId: string,
  updater: (history: RelationshipHistory) => RelationshipHistory,
): Promise<RelationshipHistory> => {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })
  const key = relationshipKey(firstUserId, secondUserId)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const saved = await store.getWithMetadata(key, { type: 'json' }) as {
      data: RelationshipHistory
      etag?: string
    } | null
    const current = sanitizeHistory(saved?.data)
    const next = updater(current)
    if (JSON.stringify(current) === JSON.stringify(next)) return current

    const options = saved?.etag
      ? { onlyIfMatch: saved.etag }
      : saved
        ? undefined
        : { onlyIfNew: true as const }
    const write = await store.setJSON(key, next, options)
    if (write.modified) return next
  }

  throw new Error('关联历史同步失败，请重试')
}

const openRelationship = (firstUserId: string, secondUserId: string, startedOn: string) =>
  updateRelationshipHistory(firstUserId, secondUserId, (history) =>
    history.periods.some((period) => !period.endedOn)
      ? history
      : { periods: [...history.periods, { startedOn }] },
  )

const closeRelationship = (firstUserId: string, secondUserId: string, endedOn: string) =>
  updateRelationshipHistory(firstUserId, secondUserId, (history) => {
    const index = history.periods.findIndex((period) => !period.endedOn)
    if (index < 0) return history
    return {
      periods: history.periods.map((period, periodIndex) =>
        periodIndex === index ? { ...period, endedOn } : period,
      ),
    }
  })

const readRelationshipHistory = async (firstUserId: string, secondUserId: string) => {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })
  return sanitizeHistory(
    await store.get(relationshipKey(firstUserId, secondUserId), { type: 'json' }),
  )
}

const ensureReciprocalLegacyLinks = async (user: StoredUser): Promise<void> => {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })
  const migrationKey = `link-migrations/${RECIPROCAL_MIGRATION}/${user.id}`
  if (await store.get(migrationKey)) return

  const codes = await readCodes(user.id, user.userCode)
  const linkedUsers = await Promise.all(codes.map((code) => readUserByCode(code)))
  await Promise.all(
    linkedUsers
      .filter((linked): linked is StoredUser => linked !== null && linked.id !== user.id)
      .map((linked) => updateCodes(
        linked.id,
        (current) => current.includes(user.userCode) ? current : [...current, user.userCode],
        linked.userCode,
      )),
  )
  await store.setJSON(migrationKey, { migratedAt: new Date().toISOString() }, { onlyIfNew: true })
}

const ensureActiveRelationshipHistory = async (
  user: StoredUser,
  codes: string[],
  fallbackDate: string,
): Promise<void> => {
  const saved = await readLinkEntry(user.id)
  const storedDate = typeof saved.updatedAt === 'string' ? saved.updatedAt.slice(0, 10) : ''
  const startedOn = isDate(storedDate) ? storedDate : fallbackDate
  const linkedUsers = await Promise.all(codes.map((code) => readUserByCode(code)))
  await Promise.all(
    linkedUsers
      .filter((linked): linked is StoredUser => linked !== null && linked.id !== user.id)
      .map((linked) => openRelationship(user.id, linked.id, startedOn)),
  )
}

const isDateWithinHistory = (date: string, history: RelationshipHistory) =>
  history.periods.some(
    (period) => date >= period.startedOn && (!period.endedOn || date <= period.endedOn),
  )

const countCommonCheckinDays = (
  records: Records[],
  histories: RelationshipHistory[],
): number => {
  if (records.length < 2) return 0
  const [first, ...rest] = records
  return Object.keys(first).filter(
    (date) =>
      histories.every((history) => isDateWithinHistory(date, history)) &&
      isCheckedIn(first[date]) &&
      rest.every((memberRecords) => isCheckedIn(memberRecords[date])),
  ).length
}

const readGroup = async (user: StoredUser, codes: string[], date: string) => {
  const [selfRecords, linked] = await Promise.all([
    readRecords(user.id),
    Promise.all(
      codes.map(async (userCode) => {
        const profile = await readUserByCode(userCode)
        if (!profile || profile.id === user.id) return null
        const [records, history] = await Promise.all([
          readRecords(profile.id),
          readRelationshipHistory(user.id, profile.id),
        ])
        return { profile, records, history }
      }),
    ),
  ])
  const validLinked = linked.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  const members: GroupMember[] = validLinked.map(({ profile, records }) => ({
    displayName: profile.displayName,
    userCode: profile.userCode,
    checked: isCheckedIn(records[date]),
  }))

  return {
    members,
    commonCheckinDays: members.length > 0
      ? countCommonCheckinDays(
          [selfRecords, ...validLinked.map(({ records }) => records)],
          validLinked.map(({ history }) => history),
        )
      : 0,
  }
}

export default async (request: Request, _context: Context) => {
  const result = await requireUser(request)
  if (result instanceof Response) return result
  const user = result
  const date = parseDate(request)

  try {
    await ensureReciprocalLegacyLinks(user)

    if (request.method === 'GET') {
      const codes = await readCodes(user.id, user.userCode)
      await ensureActiveRelationshipHistory(user, codes, date)
      return json(await readGroup(user, codes, date))
    }

    if (request.method === 'PUT') {
      const body = await request.json().catch(() => null) as { codes?: unknown } | null
      if (!Array.isArray(body?.codes)) return json({ error: '关联用户格式不正确' }, 400)

      const requestedCodes = normalizeCodes(body.codes, user.userCode)
      const resolved = await Promise.all(requestedCodes.map((code) => readUserByCode(code)))
      const linkedUsers = resolved.filter(
        (linked): linked is StoredUser => linked !== null && linked.id !== user.id,
      )
      const desiredCodes = linkedUsers.map((linked) => linked.userCode)
      const previousCodes = await readCodes(user.id, user.userCode)
      const added = linkedUsers.filter((linked) => !previousCodes.includes(linked.userCode))
      const removedCodes = previousCodes.filter((code) => !desiredCodes.includes(code))
      const removedUsers = await Promise.all(removedCodes.map((code) => readUserByCode(code)))

      await Promise.all([
        updateCodes(user.id, () => desiredCodes, user.userCode),
        ...added.map((linked) => updateCodes(
          linked.id,
          (current) => current.includes(user.userCode) ? current : [...current, user.userCode],
          linked.userCode,
        )),
        ...removedUsers
          .filter((linked): linked is StoredUser => linked !== null)
          .map((linked) => updateCodes(
            linked.id,
            (current) => current.filter((code) => code !== user.userCode),
            linked.userCode,
          )),
        ...added.map((linked) => openRelationship(user.id, linked.id, date)),
        ...removedUsers
          .filter((linked): linked is StoredUser => linked !== null)
          .map((linked) => closeRelationship(user.id, linked.id, date)),
      ])

      return json(await readGroup(user, desiredCodes, date))
    }

    return json({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : '关联关系同步失败，请重试' }, 500)
  }
}

export const config: Config = {
  path: '/api/groups',
  method: ['GET', 'PUT'],
}
