import { randomUUID } from 'node:crypto'
import {
  clearSessionCookie,
  generateSalt,
  hashPassword,
  readCookie,
  sessionCookie,
  signSession,
  verifyPassword,
  verifySession,
} from './crypto.mts'
import { allowOrReject } from './limits.mts'
import {
  createUser,
  readUserById,
  readUserByUsername,
  StoredUser,
  toPublicUser,
} from './store.mts'

const isSecure = (request: Request): boolean => new URL(request.url).protocol === 'https:'

const parseBody = async (request: Request): Promise<Record<string, unknown> | null> =>
  (await request.json().catch(() => null)) as Record<string, unknown> | null

export const getUserFromRequest = async (request: Request): Promise<StoredUser | null> => {
  const token = readCookie(request, 'zx_session')
  const data = verifySession(token)
  if (!data) return null
  const user = await readUserById(data.sub)
  if (!user || user.username !== data.username) return null
  return user
}

export const requireUser = async (request: Request): Promise<StoredUser | Response> => {
  const user = await getUserFromRequest(request)
  if (!user) return json({ error: '请先登录' }, 401)
  return user
}

export const register = async (request: Request): Promise<Response> => {
  if (!(await allowOrReject('register', request, 20))) {
    return json({ error: '注册太频繁，请稍后再试' }, 429)
  }
  const body = await parseBody(request)
  if (!body) return json({ error: '请求格式不正确' }, 400)

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''

  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return json({ error: '用户名需为 3–20 位字母、数字或下划线' }, 400)
  }
  if (password.length < 8 || password.length > 72) {
    return json({ error: '密码需为 8–72 位' }, 400)
  }
  if (!displayName) {
    return json({ error: '请输入昵称' }, 400)
  }
  if (displayName.length > 50) {
    return json({ error: '昵称最多 50 个字符' }, 400)
  }

  if (await readUserByUsername(username)) {
    return json({ error: '用户名已被使用' }, 400)
  }

  const id = randomUUID()
  const salt = generateSalt()
  const user: StoredUser = {
    id,
    username,
    displayName,
    userCode: '',
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  }
  const created = await createUser(user)
  if (!created) {
    return json({ error: '用户名已被使用' }, 400)
  }

  const token = signSession(created.id, created.username)
  return json({ user: toPublicUser(created) }, 201, {
    'set-cookie': sessionCookie(token, isSecure(request)),
  })
}

export const login = async (request: Request): Promise<Response> => {
  if (!(await allowOrReject('login', request, 30))) {
    return json({ error: '尝试次数过多，请稍后再试' }, 429)
  }
  const body = await parseBody(request)
  if (!body) return json({ error: '请求格式不正确' }, 400)

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  const user = await readUserByUsername(username)
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
    return json({ error: '用户名或密码不正确' }, 401)
  }

  const token = signSession(user.id, user.username)
  return json({ user: toPublicUser(user) }, 200, {
    'set-cookie': sessionCookie(token, isSecure(request)),
  })
}

export const logout = (request: Request): Response =>
  json({ ok: true }, 200, {
    'set-cookie': clearSessionCookie(isSecure(request)),
  })

export const me = async (request: Request): Promise<Response> => {
  const result = await requireUser(request)
  if (result instanceof Response) return result
  return json({ user: toPublicUser(result) })
}

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  })
