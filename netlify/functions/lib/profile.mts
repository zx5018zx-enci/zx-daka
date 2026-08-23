import { requireUser } from './auth.mts'
import { allowOrReject } from './limits.mts'
import { readRecords, readUserByCode } from './store.mts'

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

export const getProfile = async (request: Request): Promise<Response> => {
  const result = await requireUser(request)
  if (result instanceof Response) return result

  if (!(await allowOrReject('profile', request, 120))) {
    return json({ error: '查询太频繁，请稍后再试' }, 429)
  }

  const code = new URL(request.url).searchParams.get('code')?.trim().toUpperCase() ?? ''
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    return json({ error: '请输入正确的 8 位用户码' }, 400)
  }

  const target = await readUserByCode(code)
  if (!target) {
    return json({ error: '没有找到该用户' }, 404)
  }

  return json({
    profile: { displayName: target.displayName, userCode: target.userCode },
    records: await readRecords(target.id),
  })
}
