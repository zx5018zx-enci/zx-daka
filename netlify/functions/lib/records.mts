import { requireUser } from './auth.mts'
import { DayRecord, LogItem, readRecords, Records, writeRecords } from './store.mts'

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

const sanitizeItems = (items: unknown): LogItem[] =>
  Array.isArray(items)
    ? items
        .filter(
          (item): item is Partial<LogItem> & Pick<LogItem, 'name' | 'amount'> =>
            Boolean(
              item &&
                typeof item.name === 'string' &&
                typeof item.amount === 'string',
            ),
        )
        .map((item) => ({
          id: typeof item.id === 'string' ? item.id : `${Date.now()}-${Math.random()}`,
          name: item.name,
          amount: item.amount,
        }))
    : []

export const sanitizeRecords = (value: unknown): Records => {
  if (!value || typeof value !== 'object') return {}
  const source = (value as { records?: unknown }).records
  if (!source || typeof source !== 'object') return {}
  const records: Records = {}
  Object.entries(source as Record<string, unknown>).forEach(([date, rawRecord]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !rawRecord || typeof rawRecord !== 'object') return
    const record = rawRecord as Partial<DayRecord>
    records[date] = {
      weight:
        typeof record.weight === 'number' && Number.isFinite(record.weight)
          ? record.weight
          : null,
      exercises: sanitizeItems(record.exercises),
      foods: sanitizeItems(record.foods),
      brushMorning: record.brushMorning === true,
      brushEvening: record.brushEvening === true,
    }
  })
  return records
}

export const getRecords = async (request: Request): Promise<Response> => {
  const result = await requireUser(request)
  if (result instanceof Response) return result
  return json({ records: await readRecords(result.id) })
}

export const putRecords = async (request: Request): Promise<Response> => {
  const result = await requireUser(request)
  if (result instanceof Response) return result
  const body = (await request.json().catch(() => null)) as { records?: unknown } | null
  if (!body || typeof body !== 'object') return json({ error: '请求格式不正确' }, 400)
  const records = sanitizeRecords(body)
  await writeRecords(result.id, records)
  return json({ records })
}
