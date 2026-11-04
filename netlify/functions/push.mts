import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import webpush, { type PushSubscription } from 'web-push'
import { createHash } from 'node:crypto'
import { requireUser } from './lib/auth.mts'
import { readUserByCode } from './lib/store.mts'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
const store = () => getStore({ name: 'zx-checkin', consistency: 'strong' })
const subscriptionKey = (id: string, endpoint: string) => `push/${id}/${createHash('sha256').update(endpoint).digest('hex')}`
const allowedEndpoint = (endpoint: string) => {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      (url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com') || url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com')
  } catch { return false }
}

export default async (request: Request) => {
  const user = await requireUser(request)
  if (user instanceof Response) return user
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY
  const subject = process.env.WEB_PUSH_SUBJECT
  if (!publicKey || !privateKey || !subject) return json({ error: '手机推送尚未配置，部署配置完成后可开启' }, 503)
  if (request.method === 'GET') {
    const entries = await store().list({ prefix: `push/${user.id}/` })
    return json({ publicKey, subscriptionIds: entries.blobs.map(({ key }) => key.split('/').pop()) })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ error: '请求格式不正确' }, 400)
  try {
    if (body.action === 'subscribe') {
      const sub = body.subscription as PushSubscription | undefined
      if (!sub || typeof sub.endpoint !== 'string' || !allowedEndpoint(sub.endpoint) ||
        typeof sub.keys?.p256dh !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(sub.keys.p256dh) ||
        typeof sub.keys?.auth !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(sub.keys.auth)) return json({ error: '通知订阅无效，请重新开启' }, 400)
      const entries = await store().list({ prefix: `push/${user.id}/` })
      const key = subscriptionKey(user.id, sub.endpoint)
      if (entries.blobs.length >= 8 && !entries.blobs.some((entry) => entry.key === key)) return json({ error: '通知设备已达上限' }, 400)
      await store().setJSON(key, sub)
      await store().setJSON(`push-owner/${key.split('/').pop()}`, { userId: user.id })
      return json({ ok: true })
    }
    if (body.action === 'unsubscribe' && typeof body.endpoint === 'string') {
      await store().delete(subscriptionKey(user.id, body.endpoint))
      return json({ ok: true })
    }
    if (body.action !== 'remind' || typeof body.code !== 'string') return json({ error: '请求格式不正确' }, 400)
    const links = await store().get(`links/${user.id}`, { type: 'json' }) as { codes?: string[] } | null
    const peer = links?.codes?.includes(body.code) ? await readUserByCode(body.code) : null
    if (!peer || peer.id === user.id) return json({ error: '只能提醒已关联的同行' }, 403)
    const reciprocal = await store().get(`links/${peer.id}`, { type: 'json' }) as { codes?: string[] } | null
    if (!reciprocal?.codes?.includes(user.userCode)) return json({ error: '同行关系已变更，请刷新页面' }, 403)
    const entries = await store().list({ prefix: `push/${peer.id}/` })
    if (!entries.blobs.length) return json({ error: '对方尚未开启手机通知，请先让对方从主屏幕打开并开启打卡提醒' }, 409)
    const key = `push-cooldown/${user.id}/${peer.id}`
    const saved = await store().getWithMetadata(key, { type: 'json' }) as { data: { until: number }; etag: string } | null
    if (saved && saved.data.until > Date.now()) return json({ error: '已提醒过了，10 分钟后可再次提醒' }, 429)
    const locked = await store().setJSON(key, { until: Date.now() + 600_000 }, saved ? { onlyIfMatch: saved.etag } : { onlyIfNew: true })
    if (!locked.modified) return json({ error: '提醒正在发送，请稍后再试' }, 429)
    webpush.setVapidDetails(subject, publicKey, privateKey)
    const results = await Promise.all(entries.blobs.map(async ({ key: subKey }) => {
      const sub = await store().get(subKey, { type: 'json' }) as PushSubscription | null
      if (!sub) return false
      const owner = await store().get(`push-owner/${subKey.split('/').pop()}`, { type: 'json' }) as { userId?: string } | null
      if (owner?.userId !== peer.id) return false
      try {
        await webpush.sendNotification(sub, JSON.stringify({ body: `${user.displayName} 提醒你：该打卡啦，一起照顾好今天的自己。` }), { TTL: 3600, urgency: 'normal', timeout: 10_000 })
        return true
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 410 || (error as { statusCode?: number }).statusCode === 404) await store().delete(subKey)
        return false
      }
    }))
    if (!results.some(Boolean)) {
      await store().delete(key)
      return json({ error: '推送未能发送，对方可能需要重新开启通知，请稍后重试' }, 502)
    }
    return json({ ok: true })
  } catch { return json({ error: '通知服务暂时不可用，请稍后重试' }, 500) }
}
export const config: Config = { path: '/api/push', method: ['GET', 'POST'] }
