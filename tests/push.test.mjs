import ts from 'typescript'
import vm from 'node:vm'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// In-memory storage and push transport: no notifications or remote data writes.
assert.match(readFileSync('netlify/functions/api.mts', 'utf8'), /excludedPath:\s*\[\s*'\/api\/groups',\s*'\/api\/push'\s*\]/, 'API catch-all must exclude the push route')
const data = new Map()
let currentUser = { id: 'alice', userCode: 'ALICE001', displayName: '测试甲' }
let deliveries = 0
let failure = 0
const fakeStore = {
  async get(key) { return data.get(key)?.value ?? null },
  async getWithMetadata(key) { const saved = data.get(key); return saved ? { data: saved.value, etag: String(saved.version) } : null },
  async setJSON(key, value, options) {
    const saved = data.get(key)
    if (options?.onlyIfNew && saved || options?.onlyIfMatch && String(saved?.version) !== options.onlyIfMatch) return { modified: false }
    data.set(key, { value, version: (saved?.version ?? 0) + 1 }); return { modified: true }
  },
  async delete(key) { data.delete(key) },
  async list({ prefix }) { return { blobs: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) } },
}
const compiled = ts.transpileModule(readFileSync('netlify/functions/push.mts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, { module, exports: module.exports, require: (name) => {
  if (name === '@netlify/blobs') return { getStore: () => fakeStore }
  if (name === './lib/auth.mts') return { requireUser: async () => currentUser ?? new Response(null, { status: 401 }) }
  if (name === './lib/store.mts') return { readUserByCode: async (code) => code === 'BOB00001' ? { id: 'bob', userCode: code } : null }
  if (name === 'web-push') return { setVapidDetails() {}, async sendNotification() { if (failure) throw { statusCode: failure }; deliveries++ } }
  if (name === 'node:crypto') return crypto
  throw new Error('Unexpected import: ' + name)
}, Response, URL, process, console, io: {
  store: fakeStore, user: () => currentUser ?? new Response(null, { status: 401 }),
  push: { setVapidDetails() {}, async sendNotification() { if (failure) throw { statusCode: failure }; deliveries++; } },
} })
const handler = module.exports.default
const call = (body) => handler(new Request('https://local.test/api/push', { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}) }))
process.env.WEB_PUSH_PUBLIC_KEY = 'test'; process.env.WEB_PUSH_PRIVATE_KEY = 'test'; process.env.WEB_PUSH_SUBJECT = 'https://local.test'
currentUser = null; assert.equal((await call()).status, 401)
currentUser = { id: 'alice', userCode: 'ALICE001', displayName: '测试甲' }
const valid = { endpoint: 'https://web.push.apple.com/test', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } }
assert.equal((await call({ action: 'subscribe', subscription: { ...valid, endpoint: 'https://127.0.0.1/secret' } })).status, 400)
assert.equal((await call({ action: 'remind', code: 'BOB00001' })).status, 403)
await fakeStore.setJSON('links/alice', { codes: ['BOB00001'] }); await fakeStore.setJSON('links/bob', { codes: ['ALICE001'] })
assert.equal((await call({ action: 'remind', code: 'BOB00001' })).status, 409)
currentUser = { id: 'bob', userCode: 'BOB00001' }
assert.equal((await call({ action: 'subscribe', subscription: valid })).status, 200)
currentUser = { id: 'alice', userCode: 'ALICE001', displayName: '测试甲' }
assert.equal((await call({ action: 'remind', code: 'BOB00001' })).status, 200); assert.equal(deliveries, 1)
assert.equal((await call({ action: 'remind', code: 'BOB00001' })).status, 429); assert.equal(deliveries, 1)
await fakeStore.delete('push-cooldown/alice/bob'); failure = 410
assert.equal((await call({ action: 'remind', code: 'BOB00001' })).status, 502)
assert.equal((await fakeStore.list({ prefix: 'push/bob/' })).blobs.length, 0)
assert.equal(await fakeStore.get('push-cooldown/alice/bob'), null)
delete process.env.WEB_PUSH_PUBLIC_KEY
assert.equal((await call()).status, 503)
let shown, clicked
const listeners = {}
vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self: { addEventListener(name, callback) { listeners[name] = callback }, registration: { async showNotification(title, options) { shown = { title, options } } }, location: { origin: 'https://local.test' }, clients: { async matchAll() { return [] }, async openWindow(url) { clicked = url } } }, URL })
let pending
listeners.push({ data: { json: () => ({ body: '测试提醒' }) }, waitUntil(p) { pending = p } }); await pending
assert.equal(shown.options.body, '测试提醒')
listeners.notificationclick({ notification: { close() {} }, waitUntil(p) { pending = p } }); await pending; assert.equal(clicked, '/')
console.log('PASS: authentication, endpoint validation, relationship checks, subscription, delivery, cooldown, expiry cleanup, missing configuration, worker notification and click')
