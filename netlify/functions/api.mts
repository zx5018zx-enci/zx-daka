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
