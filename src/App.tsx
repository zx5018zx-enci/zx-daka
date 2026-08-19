import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  DayRecord,
  EMPTY_RECORD,
  LogItem,
  Records,
  completionCount,
  createEmptyRecord,
  formatDate,
  getCheckinStats,
  hasAnyCheckin,
  isDayComplete,
  parseDate,
  shiftDate,
  shouldShowDateDot,
} from './checkin'

type User = {
  id: string
  username: string
  displayName: string
  userCode: string
}

type SharedProfile = Pick<User, 'displayName' | 'userCode'> & { records: Records }
type ModalName = 'calendar' | 'weight' | 'chart' | 'lookup' | 'photo' | 'exercise' | 'food' | null
type SyncState = 'loading' | 'saving' | 'saved' | 'error'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const LEGACY_STORAGE_KEY = 'light-checkin-data'

const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? '请求失败，请稍后重试')
  return body
}

const createId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

const sanitizeRecords = (value: unknown): Records => {
  if (!value || typeof value !== 'object') return {}
  const source = (value as { records?: unknown }).records
  if (!source || typeof source !== 'object') return {}
  const records: Records = {}
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
            id: typeof item.id === 'string' ? item.id : createId(),
            name: item.name,
            amount: item.amount,
          }))
      : []

  Object.entries(source).forEach(([date, rawRecord]) => {
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

const loadLegacyRecords = (): Records => {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    return raw ? sanitizeRecords(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

function Modal({ children, onClose, wide = false }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  const sheetRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    const syncViewport = () => {
      const viewport = window.visualViewport
      document.documentElement.style.setProperty(
        '--modal-viewport-height',
        `${viewport?.height ?? window.innerHeight}px`,
      )
      document.documentElement.style.setProperty('--modal-viewport-top', `${viewport?.offsetTop ?? 0}px`)
    }
    window.addEventListener('keydown', onKeyDown)
    window.visualViewport?.addEventListener('resize', syncViewport)
    window.visualViewport?.addEventListener('scroll', syncViewport)
    window.addEventListener('resize', syncViewport)
    document.body.classList.add('modal-open')
    syncViewport()
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.visualViewport?.removeEventListener('resize', syncViewport)
      window.visualViewport?.removeEventListener('scroll', syncViewport)
      window.removeEventListener('resize', syncViewport)
      document.body.classList.remove('modal-open')
      document.documentElement.style.removeProperty('--modal-viewport-height')
      document.documentElement.style.removeProperty('--modal-viewport-top')
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={sheetRef} className={`modal-sheet ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-handle" />
        {children}
      </section>
    </div>
  )
}

function ModalHeading({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <div className="modal-title-row">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <button className="icon-button" onClick={onClose} aria-label="关闭">×</button>
    </div>
  )
}

function EntryModal({ kind, item, onSave, onClose }: { kind: 'exercise' | 'food'; item?: LogItem; onSave: (item: LogItem) => void; onClose: () => void }) {
  const isExercise = kind === 'exercise'
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item?.amount ?? '')
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !amount.trim()) {
      setError('两项都填好，记录才完整哦')
      return
    }
    onSave({ id: item?.id ?? createId(), name: name.trim(), amount: amount.trim() })
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeading eyebrow={item ? '修改记录' : '添加记录'} title={isExercise ? '今天动了什么？' : '今天吃了什么？'} onClose={onClose} />
      <form className="entry-form" onSubmit={submit}>
        <label>
          {isExercise ? '运动名称' : '食物名称'}
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={isExercise ? '例如：慢跑' : '例如：番茄炒蛋'} maxLength={30} />
        </label>
        <label>
          {isExercise ? '时长或数量' : '吃了多少'}
          <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={isExercise ? '例如：30 分钟 / 3 公里' : '例如：一小碗 / 200 克'} maxLength={30} />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button" type="submit">保存记录</button>
      </form>
    </Modal>
  )
}

function WeightModal({ value, onSave, onClose }: { value: number | null; onSave: (value: number) => void; onClose: () => void }) {
  const [input, setInput] = useState(value?.toString() ?? '')
  const [error, setError] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const weight = Number(input)
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1000) {
      setError('请输入有效的体重数值')
      return
    }
    onSave(Math.round(weight * 10) / 10)
  }
  return (
    <Modal onClose={onClose}>
      <ModalHeading eyebrow="清晨数据" title="记录今天的体重" onClose={onClose} />
      <form className="entry-form" onSubmit={submit}>
        <label>
          体重（斤）
          <div className="weight-input-wrap">
            <input autoFocus inputMode="decimal" type="number" step="0.1" min="1" max="1000" value={input} onChange={(event) => setInput(event.target.value)} placeholder="例如：128.5" />
            <span>斤</span>
          </div>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button" type="submit">保存体重</button>
      </form>
    </Modal>
  )
}

function CalendarModal({ selected, records, today, trackingStart, onSelect, onClose }: { selected: string; records: Records; today: string; trackingStart: string; onSelect: (date: string) => void; onClose: () => void }) {
  const selectedDate = parseDate(selected)
  const [month, setMonth] = useState(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const leadingDays = new Date(year, monthIndex, 1).getDay()
  const monthDays = new Date(year, monthIndex + 1, 0).getDate()
  const cells = Array.from({ length: leadingDays + monthDays }, (_, index) => index < leadingDays ? null : index - leadingDays + 1)
  return (
    <Modal onClose={onClose}>
      <ModalHeading eyebrow="选择日期" title={`${year} 年 ${monthIndex + 1} 月`} onClose={onClose} />
      <div className="calendar-nav">
        <button onClick={() => setMonth(new Date(year, monthIndex - 1, 1))} aria-label="上个月">‹</button>
        <button className="today-button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)) }}>回到本月</button>
        <button onClick={() => setMonth(new Date(year, monthIndex + 1, 1))} aria-label="下个月">›</button>
      </div>
      <div className="calendar-grid weekday-row">{WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
      <div className="calendar-grid day-grid">
        {cells.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} />
          const date = formatDate(new Date(year, monthIndex, day))
          const showDot = shouldShowDateDot(date, today, trackingStart)
          return (
            <button key={date} className={`${date === selected ? 'selected' : ''} ${date === today ? 'today' : ''}`} onClick={() => { onSelect(date); onClose() }}>
              {day}
              {showDot ? <i className={isDayComplete(records[date]) ? 'complete' : 'incomplete'} /> : null}
            </button>
          )
        })}
      </div>
      <p className="calendar-tip">
        <span><i className="complete" /> 全部完成</span>
        <span><i className="incomplete" /> 尚有漏项</span>
      </p>
    </Modal>
  )
}

function LookupModal({ onFound, onClose }: { onFound: (profile: SharedProfile) => void; onClose: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await request<{ profile: Pick<User, 'displayName' | 'userCode'>; records: Records }>(`/api/profile?code=${encodeURIComponent(code.trim().toUpperCase())}`)
      onFound({ ...result.profile, records: result.records })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '查找失败')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal onClose={onClose}>
      <ModalHeading eyebrow="查看 TA 的记录" title="输入用户码" onClose={onClose} />
      <form className="entry-form" onSubmit={submit}>
        <label>
          8 位用户码
          <input className="code-input" autoFocus value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="例如：ABCD2345" maxLength={8} required />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={loading}>{loading ? '正在查找…' : '查看用户记录'}</button>
      </form>
    </Modal>
  )
}

function WeightChartModal({ records, onClose }: { records: Records; onClose: () => void }) {
  const points = Object.entries(records)
    .filter((entry): entry is [string, DayRecord & { weight: number }] => entry[1].weight !== null)
    .map(([date, record]) => ({ date, value: record.weight }))
    .sort((left, right) => left.date.localeCompare(right.date))
  const latest = points.at(-1)
  const first = points[0]
  const previous = points.at(-2)
  const totalChange = latest && first ? Math.round((latest.value - first.value) * 10) / 10 : 0
  const recentChange = latest && previous ? Math.round((latest.value - previous.value) * 10) / 10 : null
  const recentText = recentChange === null
    ? '再记录一天，就能看到趋势'
    : recentChange < 0
      ? `较上次下降 ${Math.abs(recentChange)} 斤`
      : recentChange > 0
        ? `较上次上升 ${recentChange} 斤`
        : '与上次持平'

  return (
    <Modal onClose={onClose} wide>
      <ModalHeading eyebrow="一路走来的变化" title="历史体重" onClose={onClose} />
      {latest ? (
        <>
          <div className="chart-stats">
            <div><span>最新体重</span><strong>{latest.value}<small> 斤</small></strong></div>
            <div><span>累计变化</span><strong className={totalChange <= 0 ? 'good' : ''}>{totalChange > 0 ? '+' : ''}{totalChange}<small> 斤</small></strong></div>
            <div><span>近期趋势</span><strong className={recentChange !== null && recentChange <= 0 ? 'good' : ''}>{recentText}</strong></div>
          </div>
          <div className="weight-history-list">
            {points.slice(-12).reverse().map((point) => <div key={point.date}><span>{point.date}</span><strong>{point.value} 斤</strong></div>)}
          </div>
          <p className="chart-note">共记录 {points.length} 次 · 体重单位：斤</p>
        </>
      ) : (
        <div className="chart-empty"><span>〰</span><h3>曲线还在等第一个点</h3><p>记录一次早晨体重后，就能在这里看见变化。</p></div>
      )}
    </Modal>
  )
}

function ContentCard({ kind, items, readOnly, onAdd, onEdit, onDelete }: { kind: 'exercise' | 'food'; items: LogItem[]; readOnly: boolean; onAdd: () => void; onEdit: (item: LogItem) => void; onDelete: (item: LogItem) => void }) {
  const exercise = kind === 'exercise'
  return (
    <section className={`content-card ${kind}-card`}>
      <div className="card-heading">
        <div className="heading-with-icon">
          <span className="card-emoji">{exercise ? '🏃' : '🥗'}</span>
          <div><p>{exercise ? '运动记录' : '饮食记录'}</p><h2>{exercise ? '今天动一动' : '好好吃每一餐'}</h2></div>
        </div>
        {!readOnly ? <button className="add-button" onClick={onAdd}>＋ 添加</button> : null}
      </div>
      {items.length === 0 ? (
        <button className="empty-state" onClick={onAdd} disabled={readOnly}>
          <span>{exercise ? '轻轻动一下，也很了不起' : '记下吃过的，了解自己的节奏'}</span>
          <small>{readOnly ? '这一天还没有记录' : '点击添加第一条记录'}</small>
        </button>
      ) : (
        <ul className="log-list">
          {items.map((item) => (
            <li key={item.id}>
              <div><strong>{item.name}</strong><span>{item.amount}</span></div>
              {!readOnly ? <div className="item-actions"><button onClick={() => onEdit(item)}>编辑</button><button className="delete-button" onClick={() => onDelete(item)}>删除</button></div> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AuthPage({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await request<{ user: User }>(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ username, password, displayName }) })
      onAuthenticated(result.user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-visual">
        <div className="auth-brand"><span>祥</span><strong>ZX打卡</strong></div>
        <div className="auth-message"><p>一起记录，也一起变得更好</p><h1>把每一次坚持，<br /><em>分享给在乎的人。</em></h1></div>
        <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">{mode === 'login' ? '欢迎回来' : '创建你的空间'}</p>
          <h2>{mode === 'login' ? '登录 ZX打卡' : '注册新账号'}</h2>
          <p className="auth-intro">{mode === 'login' ? '继续记录今天的小小进步。' : '注册后会生成专属用户码，可以分享给对象或朋友。'}</p>
          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' ? <label>昵称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="别人看到的名字" maxLength={20} required /></label> : null}
            <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3–20 位字母、数字或下划线" minLength={3} maxLength={20} autoComplete="username" required /></label>
            <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" minLength={8} maxLength={72} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
            {error ? <p className="form-error auth-error">{error}</p> : null}
            <button className="primary-button" type="submit" disabled={loading}>{loading ? '请稍候…' : mode === 'login' ? '登录' : '注册并进入'}</button>
          </form>
          <button className="auth-switch" onClick={() => { setMode((current) => current === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? '还没有账号？立即注册' : '已经有账号？返回登录'}</button>
          <p className="privacy-note">🔒 你的密码经过加密保存，打卡记录只有登录后才能修改。</p>
        </div>
      </section>
    </main>
  )
}

const demoRecords = (): Records => {
  const today = formatDate(new Date())
  return {
    [shiftDate(today, -2)]: { weight: 128.2, exercises: [{ id: 'demo-1', name: '慢跑', amount: '30 分钟' }], foods: [{ id: 'demo-2', name: '家常饭', amount: '三餐' }], brushMorning: true, brushEvening: true },
    [shiftDate(today, -1)]: { weight: 127.8, exercises: [{ id: 'demo-3', name: '散步', amount: '25 分钟' }], foods: [], brushMorning: true, brushEvening: false },
    [today]: { weight: 127.5, exercises: [{ id: 'demo-4', name: '跳绳', amount: '15 分钟' }], foods: [{ id: 'demo-5', name: '清淡饮食', amount: '三餐' }], brushMorning: true, brushEvening: true },
  }
}

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const today = formatDate(new Date())
  const demoMode = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')
  const [legacyRecords] = useState(loadLegacyRecords)
  const [records, setRecords] = useState<Records>(() => demoMode ? demoRecords() : {})
  const [loaded, setLoaded] = useState(demoMode)
  const [showImport, setShowImport] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>(demoMode ? 'saved' : 'loading')
  const [sharedProfile, setSharedProfile] = useState<SharedProfile | null>(null)
  const [selected, setSelected] = useState(today)
  const [modal, setModal] = useState<ModalName>(null)
  const [editingItem, setEditingItem] = useState<LogItem>()
  const [toast, setToast] = useState('')
  const visibleRecords = sharedProfile?.records ?? records
  const readOnly = sharedProfile !== null
  const currentRecord = visibleRecords[selected] ?? EMPTY_RECORD
  const count = completionCount(currentRecord)
  const stats = useMemo(() => getCheckinStats(visibleRecords, today), [visibleRecords, today])
  const weekDates = Array.from({ length: 7 }, (_, index) => shiftDate(selected, index - 3))

  useEffect(() => {
    if (demoMode) return
    let cancelled = false
    setSyncState('loading')
    request<{ records: Records }>('/api/records')
      .then(({ records: cloudRecords }) => {
        if (cancelled) return
        setRecords(cloudRecords)
        const hasLegacy = Object.values(legacyRecords).some(hasAnyCheckin)
        const alreadyImported = localStorage.getItem(`light-checkin-imported-${user.id}`) === 'yes'
        setShowImport(Object.keys(cloudRecords).length === 0 && hasLegacy && !alreadyImported)
        setSyncState('saved')
      })
      .catch((reason) => {
        if (!cancelled) {
          setToast(reason instanceof Error ? reason.message : '云端记录加载失败')
          setSyncState('error')
        }
      })
      .finally(() => !cancelled && setLoaded(true))
    return () => { cancelled = true }
  }, [demoMode, legacyRecords, user.id])

  useEffect(() => {
    if (!loaded || demoMode) return
    setSyncState('saving')
    const timer = window.setTimeout(() => {
      request('/api/records', { method: 'PUT', body: JSON.stringify({ records }) })
        .then(() => setSyncState('saved'))
        .catch(() => { setSyncState('error'); setToast('云端保存失败，请检查网络') })
    }, 650)
    return () => window.clearTimeout(timer)
  }, [demoMode, loaded, records])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 1800)
    return () => window.clearTimeout(timer)
  }, [toast])

  const updateRecord = (updater: (record: DayRecord) => DayRecord, message = '已自动保存') => {
    setRecords((current) => ({ ...current, [selected]: updater(current[selected] ?? createEmptyRecord()) }))
    setToast(message)
  }
  const openEntry = (kind: 'exercise' | 'food', item?: LogItem) => { setEditingItem(item); setModal(kind) }
  const saveEntry = (kind: 'exercise' | 'food', item: LogItem) => {
    const key = kind === 'exercise' ? 'exercises' : 'foods'
    updateRecord((record) => {
      const items = record[key]
      const exists = items.some((entry) => entry.id === item.id)
      return { ...record, [key]: exists ? items.map((entry) => entry.id === item.id ? item : entry) : [...items, item] }
    })
    setModal(null)
    setEditingItem(undefined)
  }
  const deleteEntry = (kind: 'exercise' | 'food', item: LogItem) => {
    if (!window.confirm(`确定删除“${item.name}”吗？`)) return
    const key = kind === 'exercise' ? 'exercises' : 'foods'
    updateRecord((record) => ({ ...record, [key]: record[key].filter((entry) => entry.id !== item.id) }), '记录已删除')
  }
  const selectedDate = parseDate(selected)
  const displayDate = selected === today ? '今天' : `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`

  return (
    <div className="app-shell">
      <header className="hero">
        <nav>
          <button className="brand brand-button" onClick={() => setModal('photo')} aria-label="查看 ZX 赵祥高清图"><span>祥</span><strong>ZX打卡</strong></button>
          <div className="nav-actions"><button className="find-user-button" onClick={() => setModal('lookup')}>⌕ 查用户</button><button className="calendar-button" onClick={() => setModal('calendar')}><span>▦</span> 月历</button></div>
        </nav>
        <div className="account-bar">
          <div className="account-person"><span>{user.displayName.slice(0, 1)}</span><div><strong>{user.displayName}</strong><small>@{user.username}</small></div></div>
          <button className="user-code" onClick={async () => { await navigator.clipboard.writeText(user.userCode).catch(() => undefined); setToast('用户码已复制') }}><small>我的用户码</small><strong>{user.userCode}</strong><span>复制</span></button>
          <span className={`sync-state ${syncState}`}>{syncState === 'loading' ? '加载中' : syncState === 'saving' ? '同步中' : syncState === 'error' ? '同步失败' : '已同步'}</span>
          <button className="logout-button" onClick={async () => { if (!demoMode) await request('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined); onLogout() }}>退出</button>
        </div>
        {sharedProfile ? <div className="viewing-banner"><span>👀 正在查看 <strong>{sharedProfile.displayName}</strong> 的记录</span><button onClick={() => setSharedProfile(null)}>返回我的记录</button></div> : null}
        <div className="hero-copy" id="top">
          <div><p className="hero-kicker">{sharedProfile ? `用户码 ${sharedProfile.userCode} · 只读查看` : '慢慢来，也是一种前进'}</p><h1>{displayDate}，<br /><em>照顾好自己。</em></h1></div>
          <div className="checkin-stats">
            <div className="streak-badge"><span>🔥</span><div><strong>{stats.streak}</strong><small>连续打卡</small></div><b>天</b></div>
            <div className="cumulative-badge"><span>🗓</span><div><strong>{stats.cumulativeDays}</strong><small>累计打卡</small><em>今天是第 {stats.todayNumber} 天</em></div><b>天</b></div>
          </div>
        </div>
        <div className="progress-card">
          <div className="progress-copy"><span>{selected === today ? '今日完成度' : '当日完成度'}</span><strong>{count}<small> / 5 项</small></strong></div>
          <div className="progress-track"><i style={{ width: `${count * 20}%` }} /></div>
          <p>{count === 5 ? '全部完成，今天的你真棒！' : count === 0 ? '从一件小事开始记录吧' : `再完成 ${5 - count} 项，给今天一个漂亮的句号`}</p>
        </div>
      </header>
      <main>
        {showImport && !readOnly ? <section className="import-banner"><div><strong>发现这台设备上的旧记录</strong><p>要导入到“{user.displayName}”的云端账号吗？</p></div><div><button onClick={() => { localStorage.setItem(`light-checkin-imported-${user.id}`, 'yes'); setShowImport(false) }}>暂不导入</button><button className="import-primary" onClick={() => { setRecords(legacyRecords); localStorage.setItem(`light-checkin-imported-${user.id}`, 'yes'); setShowImport(false); setToast('旧记录已导入，正在同步到云端') }}>立即导入</button></div></section> : null}
        <section className="date-section" aria-label="日期选择">
          <button className="date-arrow" onClick={() => setSelected(shiftDate(selected, -7))} aria-label="上一周">‹</button>
          <div className="date-strip">
            {weekDates.map((date) => {
              const parsed = parseDate(date)
              const showDot = shouldShowDateDot(date, today, stats.trackingStart)
              return <button key={date} className={`${date === selected ? 'active' : ''} ${date === today ? 'is-today' : ''}`} onClick={() => setSelected(date)}><span>{WEEKDAYS[parsed.getDay()]}</span><strong>{parsed.getDate()}</strong>{showDot ? <i className={isDayComplete(visibleRecords[date]) ? 'complete' : 'incomplete'} /> : null}</button>
            })}
          </div>
          <button className="date-arrow" onClick={() => setSelected(shiftDate(selected, 7))} aria-label="下一周">›</button>
        </section>
        {selected !== today ? <button className="back-today" onClick={() => setSelected(today)}>回到今天</button> : null}
        <section className="weight-card"><div className="weight-info"><span className="weight-icon">⚖</span><div><p>早晨体重</p>{currentRecord.weight === null ? <h2>还没有记录</h2> : <button className="weight-value" onClick={() => setModal('chart')}><strong>{currentRecord.weight}</strong><span>斤</span><small>查看趋势 ›</small></button>}</div></div>{!readOnly ? <button className="weight-action" onClick={() => setModal('weight')}>{currentRecord.weight === null ? '记录体重' : '修改'}</button> : null}</section>
        <div className="content-grid">
          <ContentCard kind="exercise" items={currentRecord.exercises} readOnly={readOnly} onAdd={() => openEntry('exercise')} onEdit={(item) => openEntry('exercise', item)} onDelete={(item) => deleteEntry('exercise', item)} />
          <ContentCard kind="food" items={currentRecord.foods} readOnly={readOnly} onAdd={() => openEntry('food')} onEdit={(item) => openEntry('food', item)} onDelete={(item) => deleteEntry('food', item)} />
        </div>
        <section className="brush-card"><div className="card-heading"><div className="heading-with-icon"><span className="card-emoji">🪥</span><div><p>小小习惯</p><h2>今天有好好刷牙吗？</h2></div></div><span className="brush-count">{Number(currentRecord.brushMorning) + Number(currentRecord.brushEvening)} / 2</span></div><div className="brush-options"><button disabled={readOnly} className={currentRecord.brushMorning ? 'checked' : ''} onClick={() => updateRecord((record) => ({ ...record, brushMorning: !record.brushMorning }))}><span className="check-circle">{currentRecord.brushMorning ? '✓' : ''}</span><div><strong>早晨刷牙</strong><small>清清爽爽开启一天</small></div></button><button disabled={readOnly} className={currentRecord.brushEvening ? 'checked' : ''} onClick={() => updateRecord((record) => ({ ...record, brushEvening: !record.brushEvening }))}><span className="check-circle">{currentRecord.brushEvening ? '✓' : ''}</span><div><strong>晚上刷牙</strong><small>干干净净进入梦乡</small></div></button></div></section>
        <footer><button className="footer-photo-button" onClick={() => setModal('photo')}><img src="/zx-footer-icon.png?v=1" alt="ZX 赵祥" /></button><p>每一个认真生活的日子，都值得被记住。——赵祥</p></footer>
      </main>
      {modal === 'calendar' ? <CalendarModal selected={selected} records={visibleRecords} today={today} trackingStart={stats.trackingStart} onSelect={setSelected} onClose={() => setModal(null)} /> : null}
      {modal === 'weight' && !readOnly ? <WeightModal value={currentRecord.weight} onSave={(value) => { updateRecord((record) => ({ ...record, weight: value })); setModal(null) }} onClose={() => setModal(null)} /> : null}
      {modal === 'chart' ? <WeightChartModal records={visibleRecords} onClose={() => setModal(null)} /> : null}
      {modal === 'lookup' ? <LookupModal onFound={setSharedProfile} onClose={() => setModal(null)} /> : null}
      {modal === 'photo' ? <Modal onClose={() => setModal(null)} wide><ModalHeading eyebrow="ZX 赵祥" title="今天必须开心幸福！" onClose={() => setModal(null)} /><figure className="photo-preview"><img src="/zx-zhaoxiang-photo.png?v=1" alt="ZX 赵祥运动主题高清图" /><figcaption>今天必须开心幸福！</figcaption></figure></Modal> : null}
      {(modal === 'exercise' || modal === 'food') ? <EntryModal kind={modal} item={editingItem} onSave={(item) => saveEntry(modal, item)} onClose={() => { setModal(null); setEditingItem(undefined) }} /> : null}
      {toast ? <div className="toast" role="status"><span>✓</span>{toast}</div> : null}
    </div>
  )
}

export default function App() {
  const demoMode = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')
  const [user, setUser] = useState<User | null | undefined>(demoMode ? { id: 'demo-user', username: 'demo', displayName: '演示账号', userCode: 'DEMO2026' } : undefined)
  useEffect(() => {
    if (demoMode) return
    request<{ user: User }>('/api/auth/me').then((result) => setUser(result.user)).catch(() => setUser(null))
  }, [demoMode])
  if (user === undefined) return <div className="app-loading"><span>祥</span><p>正在打开 ZX打卡…</p></div>
  return user ? <Dashboard user={user} onLogout={() => setUser(null)} /> : <AuthPage onAuthenticated={setUser} />
}
