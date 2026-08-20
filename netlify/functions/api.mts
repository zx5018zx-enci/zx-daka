import type { Config, Context } from '@netlify/functions'

const LEGACY_DEPLOY_ORIGIN = 'https://6a3cbb2bf41ce7e99e12f0d1--zx-wj.netlify.app'

const HOP_BY_HOP_HEADERS = [
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

export default async (request: Request, _context: Context) => {
  const incomingUrl = new URL(request.url)
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, LEGACY_DEPLOY_ORIGIN)
  const requestHeaders = new Headers(request.headers)

  HOP_BY_HOP_HEADERS.forEach((header) => requestHeaders.delete(header))
  requestHeaders.delete('accept-encoding')

  // The legacy backend validates Origin/Referer against its own host. Rewrite
  // same-site values so the browser-facing domain still passes the check, and
  // leave cross-site values untouched so the legacy CSRF guard keeps working.
  const rewriteUrl = (value: string | null): string | null => {
    if (!value) return value
    try {
      const url = new URL(value)
      if (url.origin !== incomingUrl.origin) return value
      return new URL(url.pathname + url.search, LEGACY_DEPLOY_ORIGIN).toString()
    } catch {
      return value
    }
  }
  const origin = rewriteUrl(requestHeaders.get('origin'))
  const referer = rewriteUrl(requestHeaders.get('referer'))
  if (origin) requestHeaders.set('origin', origin)
  else requestHeaders.delete('origin')
  if (referer) requestHeaders.set('referer', referer)
  else requestHeaders.delete('referer')

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: requestHeaders,
    body: request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer(),
    redirect: 'manual',
  })
  const responseHeaders = new Headers(response.headers)

  HOP_BY_HOP_HEADERS.forEach((header) => responseHeaders.delete(header))
  responseHeaders.set('cache-control', 'no-store')
  responseHeaders.set('x-zx-backend', 'legacy-bridge')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export const config: Config = {
  path: '/api/*',
  excludedPath: '/api/groups',
}
