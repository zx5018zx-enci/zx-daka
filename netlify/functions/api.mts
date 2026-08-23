import type { Config } from '@netlify/functions'
import { login, logout, me, register } from './lib/auth.mts'
import { getProfile } from './lib/profile.mts'
import { getRecords, putRecords } from './lib/records.mts'

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

const isCrossSite = (request: Request): boolean => {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).origin !== new URL(request.url).origin
  } catch {
    return true
  }
}

export default async (request: Request) => {
  if (isCrossSite(request)) {
    return json({ error: '请求来源无效' }, 403)
  }

  const path = new URL(request.url).pathname
  try {
    if (path === '/api/auth/register' && request.method === 'POST') return await register(request)
    if (path === '/api/auth/login' && request.method === 'POST') return await login(request)
    if (path === '/api/auth/logout' && request.method === 'POST') return await logout(request)
    if (path === '/api/auth/me' && request.method === 'GET') return await me(request)
    if (path === '/api/records' && request.method === 'GET') return await getRecords(request)
    if (path === '/api/records' && request.method === 'PUT') return await putRecords(request)
    if (path === '/api/profile' && request.method === 'GET') return await getProfile(request)
    if (path.startsWith('/api/')) return json({ error: '接口不存在' }, 404)
    return json({ error: 'Not found' }, 404)
  } catch (error) {
    console.error(error)
    return json({ error: '服务器开小差了，请稍后重试' }, 500)
  }
}

export const config: Config = {
  path: '/api/*',
  excludedPath: '/api/groups',
}
