import { FormEvent, ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
type GroupMember = Pick<User, 'displayName' | 'userCode'> & { checked: boolean }
type GroupResponse = { members: GroupMember[]; commonCheckinDays: number; currentCommonCheckinDay: number }
type EntryKind = 'exercise' | 'food' | 'drink'
type LogKey = 'exercises' | 'foods' | 'drinks'
type LineIconName = 'activity' | 'calendar' | 'eye' | 'flame' | 'heart' | 'lock' | 'meal' | 'scale' | 'tooth' | 'water'
type ModalName = 'calendar' | 'weight' | 'chart' | 'lookup' | 'group' | 'photo' | 'notifications' | 'reminder' | EntryKind | null
type SyncState = 'loading' | 'saving' | 'saved' | 'error'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const LEGACY_STORAGE_KEY = 'light-checkin-data'
const BANNER_PHOTOS = [
  { src: '/zx-life-photo-02.jpg', title: '生活片刻', alt: '树荫下街道上手持饮品的人物照片', position: 'center 32%' },
  { src: '/zx-life-photo-03.png', title: '湖边散步', alt: '蓝色桥栏旁的人物与湖边风景', position: 'center 52%' },
  { src: '/zx-life-photo-04.jpg', title: '街头留影', alt: '天津主题墙前的全身人物照片', position: 'center 40%' },
  { src: '/zx-life-photo-05.jpg', title: '好好吃饭', alt: '餐厅里的人物与桌上的饭菜', position: 'center 12%' },
  { src: '/zx-zhaoxiang-photo.png?v=1', title: 'ZX 赵祥', alt: 'ZX 赵祥运动主题照片', position: 'center 28%' },
]

const WEIGHT_CHART_POINT_LIMIT = 30
const ENTRY_CONFIG: Record<EntryKind, {
  logKey: LogKey
  modalTitle: string
  nameLabel: string
  namePlaceholder: string
  amountLabel: string
  amountPlaceholder: string
  icon: LineIconName
  eyebrow: string
  cardTitle: string
  emptyText: string
  recommendation?: string
}> = {
  exercise: {
    logKey: 'exercises', modalTitle: '今天动了什么？', nameLabel: '运动名称',
    namePlaceholder: '例如：慢跑', amountLabel: '时长或数量', amountPlaceholder: '例如：30 分钟 / 3 公里',
    icon: 'activity', eyebrow: '运动记录', cardTitle: '今天动一动', emptyText: '轻轻动一下，也很了不起',
  },
  food: {
    logKey: 'foods', modalTitle: '今天吃了什么？', nameLabel: '食物名称',
    namePlaceholder: '例如：番茄炒蛋', amountLabel: '吃了多少', amountPlaceholder: '例如：一小碗 / 200 克',
    icon: 'meal', eyebrow: '饮食记录', cardTitle: '好好吃每一餐', emptyText: '记下吃过的，了解自己的节奏',
  },
  drink: {
    logKey: 'drinks', modalTitle: '今天喝了什么？', nameLabel: '喝了什么',
    namePlaceholder: '例如：白开水', amountLabel: '喝了多少', amountPlaceholder: '例如：2 升 / 500 毫升',
    icon: 'water', eyebrow: '喝水记录', cardTitle: '及时补充水分', emptyText: '记下喝过的，照顾身体的需要',
    recommendation: '推荐：白开水约 2 升/天',
  },
}

const ICON_PATHS: Record<LineIconName, ReactNode> = {
  activity: <><path d="M4 17l4-5 3 2 3-5 6 4" /><path d="M6 20h12" /><circle cx="15" cy="5" r="2" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3" /></>,
  eye: <><path d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5z" /><circle cx="12" cy="12" r="2.3" /></>,
  flame: <path d="M13.5 3.5c.6 3-1.8 4.2-1.8 6.3 0 1.2.8 2 1.8 2.7-.2-2.4 1.5-3.6 2.7-5.1 1.8 2 3.3 4.3 3.3 7A7.5 7.5 0 116.8 9c.3 2.5 1.6 3.8 2.8 4.7-.5-4.5 1.1-7.8 3.9-10.2z" />,
  meal: <><path d="M5 13c1.8-4.5 5.2-7 10.4-7 1.5 0 2.7.2 3.6.6-.6 5.9-4 9.1-9.5 9.1-1.8 0-3.3-.5-4.5-1.4" /><path d="M4 20c1.7-4.4 5.3-7.5 10.3-9.8" /></>,
  heart: <path d="M20.5 5.8a5 5 0 00-7.1 0L12 7.2l-1.4-1.4a5 5 0 00-7.1 7.1L12 21l8.5-8.1a5 5 0 000-7.1z" />,
  lock: <><rect x="5" y="10" width="14" height="10" rx="3" /><path d="M8 10V7a4 4 0 018 0v3M12 14v2" /></>,
  scale: <><path d="M5 7.5A3.5 3.5 0 018.5 4h7A3.5 3.5 0 0119 7.5V19H5z" /><path d="M9 8.5a3 3 0 016 0M12 8.5l1.8-1.5" /></>,
  tooth: <path d="M8.2 3.8c1.4 0 2.3.7 3.8.7s2.4-.7 3.8-.7c2.6 0 4.2 2 4.2 4.8 0 2.2-1 4-1.8 5.8-1.1 2.5-1.6 5.8-3.3 5.8-1.4 0-1.3-4.9-2.9-4.9s-1.5 4.9-2.9 4.9c-1.7 0-2.2-3.3-3.3-5.8C5 12.6 4 10.8 4 8.6c0-2.8 1.6-4.8 4.2-4.8z" />,
  water: <path d="M12 3.5c3 4 5.3 7 5.3 10.1A5.3 5.3 0 016.7 13.6C6.7 10.5 9 7.5 12 3.5z" />,
}

function LineIcon({ name }: { name: LineIconName }) {
  return (
    <svg className="line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name]}
    </svg>
  )
}

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
      drinks: sanitizeItems(record.drinks),
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

function Modal({ children, onClose, wide = false, inactive = false, className = '' }: { children: ReactNode; onClose: () => void; wide?: boolean; inactive?: boolean; className?: string }) {
  const sheetRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (inactive) return
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
  }, [onClose, inactive])

  return (
    <div className={`modal-backdrop ${className}`} style={inactive ? { display: 'none' } : undefined} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
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

function EntryModal({ kind, item, onSave, onClose }: { kind: EntryKind; item?: LogItem; onSave: (item: LogItem) => void; onClose: () => void }) {
  const config = ENTRY_CONFIG[kind]
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
      <ModalHeading eyebrow={item ? '修改记录' : '添加记录'} title={config.modalTitle} onClose={onClose} />
      <form className="entry-form" onSubmit={submit}>
        <label>
          {config.nameLabel}
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={config.namePlaceholder} maxLength={30} />
        </label>
        <label>
          {config.amountLabel}
          <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={config.amountPlaceholder} maxLength={30} />
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
          const showDot = shouldShowDateDot(date, today, trackingStart, records[date])
          const status = isDayComplete(records[date]) ? 'day-complete' : hasAnyCheckin(records[date]) ? 'day-partial' : 'day-empty'
          return (
            <button key={date} aria-label={`${day}日，${status === 'day-complete' ? '全部完成' : status === 'day-partial' ? '部分完成' : '未打卡'}${date === today ? '，今天' : ''}`} className={`${status} ${date === selected ? 'selected' : ''} ${date === today ? 'today' : ''}`} onClick={() => { onSelect(date); onClose() }}>
              {day}{status === 'day-complete' ? <span className="calendar-status-mark" aria-hidden="true">✓</span> : null}
              {showDot ? <i className={isDayComplete(records[date]) ? 'complete' : 'incomplete'} /> : null}
            </button>
          )
        })}
      </div>
      <p className="calendar-tip">
        <span><i className="complete" /> 全部完成</span>
        <span><i className="incomplete" /> 部分完成</span>
        <span><i className="not-started" /> 未打卡</span>
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
          <input className="code-input" autoFocus value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="例如：AB12CD34" maxLength={8} required />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={loading}>{loading ? '正在查找…' : '查看用户记录'}</button>
      </form>
    </Modal>
  )
}

function GroupModal({ members, loading, onSave, onClose }: { members: GroupMember[]; loading: boolean; onSave: (codes: string[]) => Promise<void>; onClose: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const addMember = async (event: FormEvent) => {
    event.preventDefault()
    const normalized = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{8}$/.test(normalized)) {
      setError('请输入正确的 8 位用户码')
      return
    }
    if (members.some((member) => member.userCode === normalized)) {
      setError('这位用户已经在同行成员中')
      return
    }
    setError('')
    setSaving(true)
    try {
      await onSave([...members.map((member) => member.userCode), normalized])
      setCode('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '关联失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const removeMember = async (member: GroupMember) => {
    if (!window.confirm(`确定与“${member.displayName}”取消关联吗？双方都会解除关联，历史共同统计会保留。`)) return
    setSaving(true)
    setError('')
    try {
      await onSave(members.filter((item) => item.userCode !== member.userCode).map((item) => item.userCode))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移除失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="group-dialog">
      <ModalHeading eyebrow="一起坚持的人" title="同行成员" onClose={onClose} />
      <p className="group-modal-intro">输入对方的用户码，任意一方添加即可同步关联；任意一方取消，双方都会解除关联。重新关联不会丢失过去的共同打卡记录。</p>
      <form className="group-add-form" onSubmit={addMember}>
        <input className="code-input" aria-label="成员用户码" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="输入 8 位用户码" maxLength={8} />
        <button className="primary-button" type="submit" disabled={saving || loading}>{saving ? '保存中…' : '添加'}</button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <p className="group-empty">正在同步成员状态…</p> : members.length === 0 ? <p className="group-empty">还没有同行成员，添加后页面才会显示爱心。</p> : (
        <div className="group-member-list">
          {members.map((member) => (
            <div key={member.userCode}>
              <span className={member.checked ? 'checked' : ''}>{member.checked ? '✓' : ''}</span>
              <p><strong>{member.displayName}</strong><small>{member.userCode} · {member.checked ? '今天已打卡' : '今天未打卡'}</small></p>
              <button type="button" disabled={saving} className="danger-button" onClick={() => removeMember(member)}>取消关联</button>
            </div>
          ))}
        </div>
      )}
      </div>
    </Modal>
  )
}

function PushSettings({ demoMode, onClose }: { demoMode: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [message, setMessage] = useState('')
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const standalone = window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const needsInstall = apple && !standalone
  useEffect(() => {
    if (!supported || demoMode) return
    let cancelled = false
    void navigator.serviceWorker.getRegistration('/').then(async (registration) => {
      const sub = await registration?.pushManager.getSubscription()
      if (sub && Notification.permission === 'granted') {
        const { subscriptionIds } = await request<{ subscriptionIds: string[] }>('/api/push')
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint))
        const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
        if (!cancelled) setEnabled(subscriptionIds.includes(id))
      }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [supported, demoMode])
  const toggle = async () => {
    if (demoMode) { setMessage('演示模式不会订阅或发送通知，请在正式账号中开启。'); return }
    setBusy(true)
    setMessage('')
    try {
      if (enabled) {
        const registration = await navigator.serviceWorker.getRegistration('/')
        const sub = await registration?.pushManager.getSubscription()
        if (sub) {
          await request('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unsubscribe', endpoint: sub.endpoint }) })
          await sub.unsubscribe()
        }
        setEnabled(false)
        setMessage('已关闭此手机的打卡提醒。')
      } else {
        // Request permission directly from the tap, before asynchronous network work.
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') throw new Error('尚未允许通知，请到手机设置中允许 ZX打卡 通知后重试。')
        const { publicKey } = await request<{ publicKey: string }>('/api/push')
        await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        const registration = await navigator.serviceWorker.ready
        const normalized = publicKey.replace(/-/g, '+').replace(/_/g, '/')
        const key = Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), (char) => char.charCodeAt(0))
        const sub = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
        await request('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'subscribe', subscription: sub.toJSON() }) })
        setEnabled(true)
        setMessage('已开启！同行点击爱心时，这台手机可收到打卡提醒。')
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '开启失败，请稍后重试。') }
    finally { setBusy(false) }
  }
  return <Modal onClose={onClose}>
    <ModalHeading eyebrow="一起坚持" title="手机打卡提醒" onClose={onClose} />
    <div className="push-settings">
      <p>允许通知后，同行点击爱心，就能向这台手机发送打卡提醒。</p>
      {needsInstall ? <div><strong>iPhone 首次开启</strong><ol><li>用 Safari 打开正式网站。</li><li>点“分享” → “添加到主屏幕”。</li><li>从主屏幕的 ZX打卡 图标打开，登录后回到这里开启通知。</li></ol><p>需要 iOS 16.4 或更新版本。</p></div> : !supported ? <p>当前浏览器不支持手机推送。iPhone 请先将网站添加到主屏幕，再从图标打开。</p> : null}
      <button className="primary-button" onClick={() => void toggle()} disabled={busy || (!demoMode && (needsInstall || !supported))}>{busy ? '正在处理…' : enabled ? '关闭此手机提醒' : '开启此手机提醒'}</button>
      <p className="push-note">每位同行每 10 分钟可提醒一次。通知显示和声音以手机通知、专注模式设置为准。</p>
      {message ? <p role="status">{message}</p> : null}
    </div>
  </Modal>
}

function GroupHeart({ members, selfChecked, commonCheckinDays, currentCommonCheckinDay, selectedIsToday, onOpen, onRemind, reminding }: { members: GroupMember[]; selfChecked: boolean; commonCheckinDays: number; currentCommonCheckinDay: number; selectedIsToday: boolean; onOpen: () => void; onRemind: () => void; reminding: boolean }) {
  const heartId = useId()
  if (members.length === 0) return null
  const total = members.length + 1
  const checkedCount = Number(selfChecked) + members.filter((member) => member.checked).length
  const phase = checkedCount === 0 ? 'empty' : checkedCount === total ? 'full' : 'partial'
  const dateLabel = selectedIsToday ? '今天' : '当日'
  const message = phase === 'full'
    ? '全员已打卡，爱心已点亮'
    : phase === 'empty'
      ? `${dateLabel}还没有人打卡`
      : `还差 ${total - checkedCount} 人，爱心就点亮了`

  return (
    <div className={`group-heart-panel ${phase}`} aria-label={`同行打卡：${checkedCount}/${total} 人${dateLabel}已完成，截至所选日期共同打卡第 ${currentCommonCheckinDay} 天，累计共同打卡 ${commonCheckinDays} 天`}>
      <button type="button" className="group-heart-picture heart-remind" onClick={onRemind} disabled={reminding} aria-label={reminding ? '正在发送提醒' : '提醒同行打卡'} title="提醒同行打卡">
        <svg viewBox="0 0 100 110" fill="none">
          <defs>
            <path id={`${heartId}-group-heart-shape`} d="M50 87C45 82 12 59 9 39C5 13 35 6 50 27C65 6 95 13 91 39C88 59 55 82 50 87Z" />
            <clipPath id={`${heartId}-group-heart-fill`}><rect x="0" y="0" width={100 * checkedCount / total} height="100" /></clipPath>
            <linearGradient id={`${heartId}-group-heart-rose`} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#f77e97" /><stop offset="55%" stopColor="#e7547f" /><stop offset="100%" stopColor="#df3f6d" />
            </linearGradient>
            <radialGradient id={`${heartId}-group-heart-sheen`} cx=".32" cy=".18" r=".85">
              <stop stopColor="#fff" stopOpacity=".3" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
            <filter id={`${heartId}-group-heart-soft`} x="-.5" y="-.5" width="2" height="2"><feGaussianBlur stdDeviation="3" /></filter>
          </defs>
          <ellipse className="group-heart-ground" cx="51" cy="99" rx="27" ry="4" fill="#cf7d9c" filter={`url(#${heartId}-group-heart-soft)`} />
          <g className="group-heart-object">
            <use href={`#${heartId}-group-heart-shape`} fill="#fceef1" />
            <use href={`#${heartId}-group-heart-shape`} clipPath={`url(#${heartId}-group-heart-fill)`} fill={`url(#${heartId}-group-heart-rose)`} />
            <use href={`#${heartId}-group-heart-shape`} fill={`url(#${heartId}-group-heart-sheen)`} />
            <use href={`#${heartId}-group-heart-shape`} fill="none" stroke="#d63d68" strokeWidth="2" />
            <path d="M17 36C16 24 28 18 36 22" stroke="#fff" strokeOpacity=".55" strokeWidth="2.2" strokeLinecap="round" />
          </g>
          <g className="group-heart-sparks" fill="#ffdf9e">
            <path d="m87 9 1.5 4.5L93 15l-4.5 1.5L87 21l-1.5-4.5L81 15l4.5-1.5Z" />
            <path d="m10 62 1 3L14 66l-3 1-1 3-1-3-3-1 3-1Z" />
            <circle cx="79" cy="81" r="1.5" /><circle cx="9" cy="18" r="1" />
          </g>
        </svg>
      </button>
      <button type="button" className="group-heart-copy" onClick={onOpen} aria-label="查看同行成员">
        <small>同行爱心 · {selectedIsToday ? '每 30 秒更新' : '历史记录'}</small>
        <strong><b>{checkedCount}</b> / {total} 人{dateLabel}已打卡</strong>
        <span className="group-day-stats">
          <span className="group-current-day">当前第 <b>{currentCommonCheckinDay}</b> 天</span>
          <span className="group-common-days">共同打卡 <b>{commonCheckinDays}</b> 天</span>
        </span>
        <em>{message}</em>
      </button>
      <span className="group-member-dots" aria-hidden="true">
        <i className={selfChecked ? 'checked' : ''}>我</i>
        {members.slice(0, 5).map((member) => <i key={member.userCode} className={member.checked ? 'checked' : ''}>{member.displayName.slice(0, 1)}</i>)}
        {members.length > 5 ? <b>+{members.length - 5}</b> : null}
      </span>
    </div>
  )
}

type WeightPoint = { date: string; value: number }
type ChartCoordinate = WeightPoint & { x: number; y: number }

const svgNumber = (value: number) => Math.round(value * 100) / 100

const buildSmoothPath = (points: ChartCoordinate[]): string => {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${svgNumber(points[0].x)} ${svgNumber(points[0].y)}`

  return points.slice(0, -1).reduce((path, point, index) => {
    const next = points[index + 1]
    const previous = points[index - 1] ?? point
    const afterNext = points[index + 2] ?? next
    const firstControlX = point.x + (next.x - previous.x) / 6
    const firstControlY = point.y + (next.y - previous.y) / 6
    const secondControlX = next.x - (afterNext.x - point.x) / 6
    const secondControlY = next.y - (afterNext.y - point.y) / 6
    return `${path} C ${svgNumber(firstControlX)} ${svgNumber(firstControlY)}, ${svgNumber(secondControlX)} ${svgNumber(secondControlY)}, ${svgNumber(next.x)} ${svgNumber(next.y)}`
  }, `M ${svgNumber(points[0].x)} ${svgNumber(points[0].y)}`)
}

function WeightChartModal({ records, onClose }: { records: Records; onClose: () => void }) {
  const points: WeightPoint[] = Object.entries(records)
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

  const chartPoints = points.slice(-WEIGHT_CHART_POINT_LIMIT)
  const chartWidth = 720
  const chartHeight = 290
  const chartPadding = { top: 32, right: 24, bottom: 44, left: 54 }
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom
  const values = chartPoints.map((point) => point.value)
  const smallestValue = values.length > 0 ? Math.min(...values) : 0
  const largestValue = values.length > 0 ? Math.max(...values) : 0
  const valuePadding = Math.max((largestValue - smallestValue) * 0.18, 0.5)
  const chartMin = smallestValue - valuePadding
  const chartMax = largestValue + valuePadding
  const chartRange = chartMax - chartMin
  const firstTime = chartPoints[0] ? parseDate(chartPoints[0].date).getTime() : 0
  const lastTime = chartPoints.at(-1) ? parseDate(chartPoints.at(-1)!.date).getTime() : firstTime
  const timeRange = lastTime - firstTime
  const coordinates: ChartCoordinate[] = chartPoints.map((point) => ({
    ...point,
    x: chartPoints.length === 1
      ? chartPadding.left + plotWidth / 2
      : chartPadding.left + ((parseDate(point.date).getTime() - firstTime) / timeRange) * plotWidth,
    y: chartPadding.top + ((chartMax - point.value) / chartRange) * plotHeight,
  }))
  const linePath = buildSmoothPath(coordinates)
  const axisLabelIndexes = new Set(
    chartPoints.length <= 6
      ? chartPoints.map((_, index) => index)
      : [0, Math.floor((chartPoints.length - 1) / 2), chartPoints.length - 1],
  )
  const gridValues = Array.from({ length: 5 }, (_, index) => chartMax - (chartRange * index) / 4)

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
          <div className="chart-wrap">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-labelledby="weight-chart-title weight-chart-description">
              <title id="weight-chart-title">最近 {chartPoints.length} 次体重变化曲线</title>
              <desc id="weight-chart-description">从 {chartPoints[0].date} 的 {chartPoints[0].value} 斤，到 {chartPoints.at(-1)!.date} 的 {chartPoints.at(-1)!.value} 斤。</desc>
              <defs>
                <linearGradient id="weight-area-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7fa38b" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#7fa38b" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {gridValues.map((value, index) => {
                const y = chartPadding.top + (plotHeight * index) / 4
                return (
                  <g key={value}>
                    <line className="grid-line" x1={chartPadding.left} y1={y} x2={chartWidth - chartPadding.right} y2={y} />
                    <text className="axis-text" x={chartPadding.left - 9} y={y + 3} textAnchor="end">{value.toFixed(1)}</text>
                  </g>
                )
              })}
              {coordinates.length > 1 ? (
                <path className="weight-area" d={`${linePath} L ${svgNumber(coordinates.at(-1)!.x)} ${chartPadding.top + plotHeight} L ${svgNumber(coordinates[0].x)} ${chartPadding.top + plotHeight} Z`} />
              ) : null}
              <path className="weight-line" d={linePath} />
              {coordinates.map((point, index) => (
                <g key={point.date}>
                  <circle className="weight-dot" cx={point.x} cy={point.y} r={5}>
                    <title>{point.date}：{point.value} 斤</title>
                  </circle>
                  {(coordinates.length <= 6 || index === coordinates.length - 1) ? (
                    <text className="value-label" x={point.x} y={point.y - 11} textAnchor="middle">{point.value}</text>
                  ) : null}
                  {axisLabelIndexes.has(index) ? (
                    <text className="axis-text" x={point.x} y={chartHeight - 15} textAnchor="middle">{Number(point.date.slice(5, 7))}/{Number(point.date.slice(8, 10))}</text>
                  ) : null}
                </g>
              ))}
            </svg>
            <p className="chart-window-note">曲线展示最近 {chartPoints.length} 次记录</p>
          </div>
          <div className="weight-history-list">
            {points.slice(-WEIGHT_CHART_POINT_LIMIT).reverse().map((point) => <div key={point.date}><span>{point.date}</span><strong>{point.value} 斤</strong></div>)}
          </div>
          <p className="chart-note">共记录 {points.length} 次 · 体重单位：斤</p>
        </>
      ) : (
        <div className="chart-empty"><span>〰</span><h3>曲线还在等第一个点</h3><p>记录一次早晨体重后，就能在这里看见变化。</p></div>
      )}
    </Modal>
  )
}

function ContentCard({ kind, items, readOnly, onAdd, onEdit, onDelete, children }: { kind: EntryKind; items: LogItem[]; readOnly: boolean; onAdd: () => void; onEdit: (item: LogItem) => void; onDelete: (item: LogItem) => void; children?: ReactNode }) {
  const config = ENTRY_CONFIG[kind]
  return (
    <section className={`content-card ${kind}-card`}>
      <div className="card-heading">
        <div className="heading-with-icon">
          <span className="card-icon"><LineIcon name={config.icon} /></span>
          <div>
            <p>{config.eyebrow}</p>
            <h2>{config.cardTitle}</h2>
            {config.recommendation ? <small className="card-recommendation">{config.recommendation}</small> : null}
          </div>
        </div>
        {!readOnly ? <button className="add-button" onClick={onAdd}>＋ 添加</button> : null}
      </div>
      {children}
      {items.length === 0 ? (
        <div className="record-empty-state">
          <LineIcon name={config.icon} />
          <p>{readOnly ? '这一天还没有记录' : config.emptyText}</p>
          {!readOnly ? <button className="secondary-button" onClick={onAdd}>记录{kind === 'exercise' ? '运动' : kind === 'food' ? '饮食' : '饮水'}</button> : null}
        </div>
      ) : (
        <ul className="log-list">
          {items.map((item) => (
            <li key={item.id}>
              <div><strong>{item.name}</strong><span>{item.amount}</span></div>
              {!readOnly ? (
                <details className="item-menu">
                  <summary aria-label={`${item.name}的更多操作`}>•••</summary>
                  <div>
                    <button type="button" onClick={() => onEdit(item)}>编辑</button>
                    <button type="button" className="delete-button" onClick={() => onDelete(item)}>删除</button>
                  </div>
                </details>
              ) : null}
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
        <div className="auth-message"><span className="auth-growth-mark" aria-hidden="true"><LineIcon name="activity" /></span><p>你的日常，值得被认真记录</p><h1>一起记录，<br /><em>也一起坚持。</em></h1><p>体重、饮食、运动与生活习惯，<br />把每一天的小进步留在这里。</p></div>
        <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">{mode === 'login' ? '欢迎回来' : '创建你的空间'}</p>
          <h2>{mode === 'login' ? '登录 ZX打卡' : '注册新账号'}</h2>
          <p className="auth-intro">{mode === 'login' ? '继续记录今天的小小进步。' : '注册后会生成专属用户码，可以分享给对象或朋友。'}</p>
          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' ? <label>昵称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} aria-describedby="nickname-hint" maxLength={20} required /><small id="nickname-hint">别人看到的名字</small></label> : null}
            <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} aria-describedby="username-hint" minLength={3} maxLength={20} autoComplete="username" required /><small id="username-hint">3–20 位字母、数字或下划线</small></label>
            <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="password-hint" minLength={8} maxLength={72} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /><small id="password-hint">至少 8 位</small></label>
            {error ? <div className="auth-recovery" role="alert"><p className="form-error auth-error">{error}</p><button type="button" className="secondary-button" onClick={() => { setPassword(''); setError(''); }}>重新输入密码</button><details><summary>忘记账号或密码？</summary><p>请先检查用户名和输入法，或联系站点管理员协助核验账号。本站暂不支持自助重置密码。</p></details></div> : null}
            {mode === 'register' ? <label className="privacy-consent"><input type="checkbox" required /> <span>我已了解：账号与打卡记录会保存到云端，其他登录用户可通过我的用户码查看记录。</span></label> : null}
            <button className="primary-button" type="submit" disabled={loading}>{loading ? '请稍候…' : mode === 'login' ? '登录' : '注册并进入'}</button>
          </form>
          <button className="auth-switch" onClick={() => { setMode((current) => current === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? '还没有账号？立即注册' : '已经有账号？返回登录'}</button>
          <p className="privacy-note"><LineIcon name="lock" />你的密码经过加密保存，打卡记录只有登录后才能修改。</p><p className="auth-copyright">© {new Date().getFullYear()} ZX打卡</p>
        </div>
      </section>
    </main>
  )
}

const demoRecords = (): Records => {
  const today = formatDate(new Date())
  return {
    [shiftDate(today, -2)]: { weight: 128.2, exercises: [{ id: 'demo-1', name: '慢跑', amount: '30 分钟' }], foods: [{ id: 'demo-2', name: '家常饭', amount: '三餐' }], drinks: [{ id: 'demo-6', name: '白开水', amount: '2 升' }], brushMorning: true, brushEvening: true },
    [shiftDate(today, -1)]: { weight: 127.8, exercises: [{ id: 'demo-3', name: '散步', amount: '25 分钟' }], foods: [], drinks: [{ id: 'demo-7', name: '白开水', amount: '1.5 升' }], brushMorning: true, brushEvening: false },
    [today]: { weight: 127.5, exercises: [{ id: 'demo-4', name: '跳绳', amount: '15 分钟' }], foods: [{ id: 'demo-5', name: '清淡饮食', amount: '三餐' }], drinks: [{ id: 'demo-8', name: '白开水', amount: '2 升' }], brushMorning: true, brushEvening: true },
  }
}

const DEMO_GROUP: GroupMember[] = [
  { displayName: '小洁', userCode: 'MOON0001', checked: true },
]

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const today = formatDate(new Date())
  const demoParams = new URLSearchParams(window.location.search)
  const demoMode = import.meta.env.DEV && demoParams.has('demo')
  const demoWithoutGroup = demoMode && demoParams.get('group') === 'none'
  const demoFullGroup = demoMode && demoParams.get('group') === 'full'
  const demoCelebration = demoMode && demoParams.has('celebrate')
  const [legacyRecords] = useState(loadLegacyRecords)
  const [records, setRecords] = useState<Records>(() => demoMode ? demoRecords() : {})
  const [loaded, setLoaded] = useState(demoMode)
  const [showImport, setShowImport] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>(demoMode ? 'saved' : 'loading')
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>(() =>
    demoMode && !demoWithoutGroup
      ? DEMO_GROUP.map((member) => demoFullGroup ? { ...member, checked: true } : member)
      : [],
  )
  const [commonCheckinDays, setCommonCheckinDays] = useState(
    demoMode && !demoWithoutGroup ? (demoFullGroup ? 3 : 2) : 0,
  )
  const [currentCommonCheckinDay, setCurrentCommonCheckinDay] = useState(0)
  const [groupLoading, setGroupLoading] = useState(!demoMode)
  const groupFetchVersion = useRef(0)
  const [sharedProfile, setSharedProfile] = useState<SharedProfile | null>(null)
  const [companionCode, setCompanionCode] = useState('')
  const companion = sharedProfile ? undefined : groupMembers.find((member) => member.userCode === companionCode) ?? groupMembers[0]
  const peerCode = sharedProfile ? '' : companion?.userCode ?? ''
  const [peerState, setPeerState] = useState<{ code: string; status: 'loading' | 'ready' | 'error'; profile?: SharedProfile }>({ code: '', status: 'loading' })
  const [peerRetry, setPeerRetry] = useState(0)

  const [selected, setSelected] = useState(today)
  const [weekCenter, setWeekCenter] = useState(today)
  const [modal, setModal] = useState<ModalName>(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  const activePhoto = BANNER_PHOTOS[photoIndex]
  const changePhoto = (step: number) => setPhotoIndex((index) => (index + step + BANNER_PHOTOS.length) % BANNER_PHOTOS.length)

  const [showCompanionRecords, setShowCompanionRecords] = useState(false)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const headerMenuRef = useRef<HTMLDivElement>(null)
  const headerMenuButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!headerMenuOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerMenuRef.current?.contains(event.target)) setHeaderMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setHeaderMenuOpen(false)
      headerMenuButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [headerMenuOpen])

  const [editingItem, setEditingItem] = useState<LogItem>()
  const [toast, setToast] = useState('')
  const [reminding, setReminding] = useState(false)
  const remindLock = useRef(false)
  const remindCompanion = async (targetCode = peerCode) => {
    if (remindLock.current) return
    if (demoMode) { setToast('演示模式：模拟提醒，不会发送手机通知'); return }
    if (!targetCode) { setToast('请先添加同行'); return }
    remindLock.current = true
    setReminding(true)
    try {
      await request('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remind', code: targetCode }) })
      setToast(`已向${groupMembers.find((member) => member.userCode === targetCode)?.displayName ?? '同行'}的手机发送提醒`)
    } catch (error) { setToast(error instanceof Error ? error.message : '发送失败，请重试') }
    finally { remindLock.current = false; setReminding(false) }
  }
  const visibleRecords = sharedProfile?.records ?? records
  const readOnly = sharedProfile !== null || !loaded
  const currentRecord = visibleRecords[selected] ?? EMPTY_RECORD
  const count = completionCount(currentRecord)
  const previousCompletion = useRef({ selected, count })
  const demoCelebrationPlayed = useRef(false)
  const stats = useMemo(
    () => getCheckinStats(visibleRecords, today, selected),
    [visibleRecords, today, selected],
  )
  const demoCommonCheckinDates = [shiftDate(today, -2), shiftDate(today, -1), ...(demoFullGroup ? [today] : [])]
  const displayedCurrentCommonDay = demoMode
    ? demoCommonCheckinDates.filter((date) => date <= selected).length
    : currentCommonCheckinDay
  const displayedGroupMembers = demoMode && selected !== today
    ? groupMembers.map((member) => ({ ...member, checked: demoCommonCheckinDates.includes(selected) }))
    : groupMembers

  useEffect(() => {
    if (!peerCode) return
    if (demoMode) {
      const sample = demoRecords()
      sample[today] = demoFullGroup
        ? { weight: 112.6, exercises: [{ id: 'peer-run', name: '快走', amount: '40 分钟' }], foods: [{ id: 'peer-meal', name: '鸡胸肉、蔬菜', amount: '一份' }], drinks: [{ id: 'peer-water', name: '白开水', amount: '1.5 升' }], brushMorning: true, brushEvening: true }
        : { weight: 112.6, exercises: [], foods: [{ id: 'peer-meal', name: '鸡胸肉、蔬菜', amount: '一份' }], drinks: [], brushMorning: true, brushEvening: false }
      setPeerState({ code: peerCode, status: 'ready', profile: { displayName: companion?.displayName ?? '同行', userCode: peerCode, records: sample } })
      return
    }
    let cancelled = false
    let inFlight = false
    const controller = new AbortController()
    setPeerState({ code: peerCode, status: 'loading' })
    const refreshPeer = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const result = await request<{ profile: Pick<User, 'displayName' | 'userCode'>; records: Records }>(`/api/profile?code=${encodeURIComponent(peerCode)}`, { signal: controller.signal })
        if (!cancelled) setPeerState({ code: peerCode, status: 'ready', profile: { ...result.profile, records: result.records } })
      } catch {
        if (!cancelled) setPeerState({ code: peerCode, status: 'error' })
      } finally { inFlight = false }
    }
    void refreshPeer()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshPeer() }, 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshPeer() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [peerCode, peerRetry, demoMode, demoFullGroup, today, companion?.displayName])

  const refreshGroup = useCallback(async () => {
    if (demoMode) return
    const version = ++groupFetchVersion.current
    try {
      const result = await request<GroupResponse>(`/api/groups?date=${selected}&today=${today}`)
      if (version !== groupFetchVersion.current) return
      setGroupMembers(result.members)
      setCommonCheckinDays(result.commonCheckinDays)
      setCurrentCommonCheckinDay(result.currentCommonCheckinDay)
    } catch {
      // The group endpoint is additive; existing check-in flows stay available if it is temporarily unavailable.
    } finally {
      if (version === groupFetchVersion.current) setGroupLoading(false)
    }
  }, [demoMode, selected, today])

  useEffect(() => {
    void refreshGroup()
    if (demoMode) return
    const timer = window.setInterval(refreshGroup, 30_000)
    const refreshWhenVisible = () => document.visibilityState === 'visible' && void refreshGroup()
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      groupFetchVersion.current += 1
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [demoMode, refreshGroup])

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
    const timer = window.setTimeout(() => setToast(''), toast.includes('全部完成') ? 2800 : 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const previous = previousCompletion.current
    previousCompletion.current = { selected, count }
    const completedNow = previous.selected === selected && previous.count < 6 && count === 6
    const previewCelebration = demoCelebration && !demoCelebrationPlayed.current && count === 6
    if (!completedNow && !previewCelebration) return
    const celebrate = () => {
      demoCelebrationPlayed.current = true
      setToast(`${selected === today ? '今天' : '当日'} 6 项全部完成，太棒了！`)
    }
    const previewTimer = previewCelebration ? window.setTimeout(celebrate, 650) : 0
    if (!previewCelebration) celebrate()
    return () => {
      if (previewTimer) window.clearTimeout(previewTimer)
    }
  }, [count, demoCelebration, selected])

  const updateRecord = (updater: (record: DayRecord) => DayRecord, message = '记录已更新') => {
    setRecords((current) => ({ ...current, [selected]: updater(current[selected] ?? createEmptyRecord()) }))
    setToast(message)
  }
  const openEntry = (kind: EntryKind, item?: LogItem) => { setEditingItem(item); setModal(kind) }
  const saveEntry = (kind: EntryKind, item: LogItem) => {
    const key = ENTRY_CONFIG[kind].logKey
    updateRecord((record) => {
      const items = record[key] ?? []
      const exists = items.some((entry) => entry.id === item.id)
      return { ...record, [key]: exists ? items.map((entry) => entry.id === item.id ? item : entry) : [...items, item] }
    })
    setModal(null)
    setEditingItem(undefined)
  }
  const deleteEntry = (kind: EntryKind, item: LogItem) => {
    if (!window.confirm(`确定删除“${item.name}”吗？`)) return
    const key = ENTRY_CONFIG[kind].logKey
    updateRecord((record) => ({ ...record, [key]: (record[key] ?? []).filter((entry) => entry.id !== item.id) }), '记录已删除')
  }
  const weekDates = Array.from({ length: 7 }, (_, index) => shiftDate(weekCenter, index - 3))
  const shiftVisibleWeek = (days: number) => {
    setWeekCenter((current) => shiftDate(current, days))
    setSelected((current) => shiftDate(current, days))
  }
  const selectFromCalendar = (date: string) => {
    setSelected(date)
    setWeekCenter(date)
  }
  const returnToToday = () => {
    setSelected(today)
    setWeekCenter(today)
  }
  const saveGroupCodes = async (codes: string[]) => {
    groupFetchVersion.current += 1
    if (demoMode) {
      setGroupMembers((current) => codes.map((code) => current.find((member) => member.userCode === code) ?? { displayName: `同行 ${code.slice(-2)}`, userCode: code, checked: false }))
      setCommonCheckinDays(codes.length > 0 ? 2 : 0)
      return
    }
    const result = await request<GroupResponse>(`/api/groups?date=${today}`, {
      method: 'PUT',
      body: JSON.stringify({ codes }),
    })
    if (result.members.length < codes.length) throw new Error('没有找到该用户码，请检查后重试')
    setGroupMembers(result.members)
    setCommonCheckinDays(result.commonCheckinDays)
    setCurrentCommonCheckinDay(result.currentCommonCheckinDay)
  }
  const selectedDate = parseDate(selected)
  const quickWater = currentRecord.drinks?.find((item) => item.id === 'quick-water')
  const waterCups = Math.min(8, Math.max(0, Number.parseInt(quickWater?.amount ?? '0', 10) || 0))
  const setWaterCups = (cups: number) => updateRecord((record) => ({ ...record, drinks: [...(record.drinks ?? []).filter((item) => item.id !== 'quick-water'), ...(cups > 0 ? [{ id: 'quick-water', name: '快捷饮水', amount: `${cups} 杯（每杯 250 毫升）` }] : [])] }), `快捷饮水已记录 ${cups} 杯`)
  const displayDate = selected === today ? '今天' : `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`

  const paired = Boolean(companion && !sharedProfile)
  const peerReady = peerState.code === peerCode && peerState.status === 'ready'
  const peerFailed = peerState.code === peerCode && peerState.status === 'error'
  const peerRecord = peerReady ? peerState.profile?.records[selected] ?? EMPTY_RECORD : undefined
  const rowDefinitions: { key: 'weight' | EntryKind | 'brushMorning' | 'brushEvening'; label: string; icon: LineIconName }[] = [
    { key: 'weight', label: '体重', icon: 'scale' },
    { key: 'exercise', label: '运动', icon: 'activity' },
    { key: 'food', label: '饮食', icon: 'meal' },
    { key: 'drink', label: '喝水', icon: 'water' },
    { key: 'brushMorning', label: '早晨刷牙', icon: 'tooth' },
    { key: 'brushEvening', label: '晚上刷牙', icon: 'tooth' },
  ]
  const renderDailyCell = (key: typeof rowDefinitions[number]['key'], record: DayRecord | undefined, own: boolean) => {
    const editable = own && !readOnly
    if (!record) return <span className="daily-pending">{peerFailed ? '暂时无法读取' : '正在同步…'}</span>
    if (key === 'weight') return (
      <div className="daily-weight-value">
        {record.weight !== null ? <strong>{record.weight}<small> 斤</small></strong> : <span className="daily-unrecorded">未记录</span>}
        {editable ? <button className="daily-text-action" onClick={() => setModal('weight')}>{record.weight === null ? '记录' : '修改'}</button> : null}
      </div>
    )
    if (key === 'brushMorning' || key === 'brushEvening') return editable
      ? <button className={`daily-brush-toggle ${record[key] ? 'done' : ''}`} aria-pressed={record[key]} onClick={() => updateRecord((value) => ({ ...value, [key]: !value[key] }))}><span aria-hidden="true">{record[key] ? '✓' : '○'}</span>{record[key] ? '已刷牙' : '打个卡'}</button>
      : <span className={`daily-read-status ${record[key] ? 'done' : ''}`}><span aria-hidden="true">{record[key] ? '✓' : '—'}</span>{record[key] ? '已刷牙' : '未打卡'}</span>
    const entries = record[ENTRY_CONFIG[key].logKey] ?? []
    return (
      <div className="daily-entry-cell">
        {entries.length ? <ul>{entries.map((item) => <li key={item.id}>
          {editable ? <button className="daily-entry-edit" aria-label={`修改${item.name}`} onClick={() => openEntry(key, item)}><span>{item.name}</span><small>{item.amount}</small></button> : <div><span>{item.name}</span><small>{item.amount}</small></div>}
          {editable ? <button className="daily-entry-delete" aria-label={`删除${item.name}`} onClick={() => deleteEntry(key, item)}>×</button> : null}
        </li>)}</ul> : <span className="daily-unrecorded">未记录</span>}
        {editable ? <div className="daily-entry-actions"><button className="daily-text-action" onClick={() => openEntry(key)}>＋ {entries.length ? '添加' : '记录'}</button>
          {key === 'drink' ? <span className="daily-water-stepper"><button aria-label="快捷饮水减少一杯" disabled={waterCups === 0} onClick={() => setWaterCups(waterCups - 1)}>−</button><span>{waterCups} 杯</span><button aria-label="快捷饮水增加一杯" disabled={waterCups === 8} onClick={() => setWaterCups(waterCups + 1)}>＋</button></span> : null}
        </div> : null}
      </div>
    )
  }
  const companionRecordsView = (
    <div className="app-shell daily-app">
      <header className="daily-header">
        <nav>
          <button className="brand brand-button" onClick={() => setModal('photo')} aria-label="祥字站标，查看今日寄语"><span>祥</span><strong>ZX打卡</strong></button>
          <div className="daily-header-actions">
            <button onClick={() => setModal('group')}>同行</button>
            <button onClick={() => setModal('lookup')}>查用户</button>
            <details className="daily-account"><summary>我的</summary><div>
              <strong>{user.displayName}</strong><small>@{user.username}</small>
              <button onClick={async () => { await navigator.clipboard.writeText(user.userCode).catch(() => undefined); setToast('用户码已复制') }}>复制用户码 · {user.userCode}</button>
              <span role="status">{syncState === 'loading' ? '加载中' : syncState === 'saving' ? '保存中' : syncState === 'error' ? '保存失败，请检查网络' : '记录已同步'}</span>
              <button onClick={() => setModal('chart')}>体重趋势</button>
              <button onClick={async () => { if (!demoMode) await request('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined); onLogout() }}>退出登录</button>
            </div></details>
          </div>
        </nav>
      </header>
      <main className={`daily-main ${paired ? 'paired' : 'solo'}`}>
        <div className="daily-heading">
          <div><h1>{sharedProfile ? `${sharedProfile.displayName}的记录` : '每日记录'}</h1><p>{stats.streak > 0 ? `连续 ${stats.streak} 天` : '从今天开始'}<span> · </span>累计 {stats.cumulativeDays} 天</p></div>
          <div className="daily-date-nav"><button aria-label="前一天" onClick={() => selectFromCalendar(shiftDate(selected, -1))}>‹</button><button className="daily-date-label" onClick={() => setModal('calendar')}>{displayDate}<small>{selectedDate.getMonth() + 1}.{selectedDate.getDate()}</small></button><button aria-label="后一天" onClick={() => selectFromCalendar(shiftDate(selected, 1))}>›</button></div>
        </div>
        {selected !== today ? <button className="daily-return-today" onClick={returnToToday}>回到今天</button> : null}
        {sharedProfile ? <div className="daily-notice">正在只读查看对方的记录。<button onClick={() => setSharedProfile(null)}>返回我的记录</button></div> : null}
        {showImport && !readOnly ? <div className="daily-notice">发现此设备的旧记录。<button onClick={() => { setRecords(legacyRecords); localStorage.setItem(`light-checkin-imported-${user.id}`, 'yes'); setShowImport(false); setToast('旧记录已导入，正在同步') }}>导入</button><button onClick={() => { localStorage.setItem(`light-checkin-imported-${user.id}`, 'yes'); setShowImport(false) }}>暂不导入</button></div> : null}
        {paired ? <div className="daily-companion-strip"><GroupHeart members={displayedGroupMembers} selfChecked={hasAnyCheckin(records[selected])} commonCheckinDays={commonCheckinDays} currentCommonCheckinDay={displayedCurrentCommonDay} selectedIsToday={selected === today} onOpen={() => setModal('group')} onRemind={() => { if (groupMembers.length > 1) setModal('reminder'); else void remindCompanion() }} reminding={reminding} />
          {groupMembers.length > 1 ? <select aria-label="选择同行成员" value={peerCode} onChange={(event) => setCompanionCode(event.target.value)}>{groupMembers.map((member) => <option key={member.userCode} value={member.userCode}>{member.displayName}</option>)}</select> : null}
        </div> : null}
        {paired && peerFailed ? <div className="daily-notice" role="alert">对方的记录暂时读取失败。<button onClick={() => setPeerRetry((value) => value + 1)}>重新读取</button></div> : null}
        <section className="daily-sheet" aria-label={paired ? '双方打卡记录' : '我的打卡记录'}>
          <div className="daily-column-head"><span className="daily-item-column">项目</span><div><strong>{sharedProfile?.displayName ?? '我'}</strong><small>{loaded ? `${count}/6 项${readOnly ? ' · 只读' : ''}` : '读取中'}</small></div>{paired ? <div className="daily-peer-head"><strong>{peerState.code === peerCode && peerReady ? peerState.profile?.displayName : companion?.displayName}</strong><small>{peerRecord ? `${completionCount(peerRecord)}/6 项 · 只读` : peerFailed ? '读取失败' : '同步中'}</small></div> : null}</div>
          {rowDefinitions.map((row) => <section className="daily-record-row" key={row.key} aria-label={row.label}>
            <h2><LineIcon name={row.icon} />{row.label}</h2>
            <div className="daily-record-cell daily-own-cell">{renderDailyCell(row.key, loaded ? currentRecord : undefined, true)}</div>
            {paired ? <div className="daily-record-cell daily-peer-cell">{renderDailyCell(row.key, peerRecord, false)}</div> : null}
          </section>)}
        </section>
        <div className="daily-bottom-line"><span>{syncState === 'loading' ? '正在读取…' : syncState === 'saving' ? '正在保存…' : syncState === 'error' ? '保存失败，请检查网络' : demoMode ? '演示数据' : '自动保存'}{paired ? ' · 对方记录每 30 秒同步' : ''}</span><button onClick={() => setModal('photo')}>今日寄语 ↗</button></div>
      </main>
    </div>
  )
  const recentWeights = Object.entries(visibleRecords)
    .filter(([date, record]) => date <= selected && date >= shiftDate(selected, -6) && record.weight !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, record]) => ({ date, value: record.weight as number }))
  const miniMin = Math.min(...recentWeights.map((point) => point.value))
  const miniMax = Math.max(...recentWeights.map((point) => point.value))
  const miniPoints = recentWeights.map((point, index) => `${8 + index / Math.max(1, recentWeights.length - 1) * 144},${42 - (point.value - miniMin) / Math.max(.1, miniMax - miniMin) * 28}`).join(' ')
  const checkinStats = (
          <div className="checkin-stats">
            <div className="stat-card stat-card-streak">
              <div className="stat-card-heading"><span aria-hidden="true"><LineIcon name="flame" /></span><strong>连续打卡</strong></div>
              <div className="stat-card-value"><b className={stats.streak === 0 ? 'streak-start' : ''}>{stats.streak === 0 ? '今天开始' : stats.streak}</b>{stats.streak > 0 ? <span>天</span> : null}</div>
              <p>当前连续记录</p>
            </div>
            <div className="stat-card stat-card-total">
              <div className="stat-card-heading"><span aria-hidden="true"><LineIcon name="calendar" /></span><strong>累计打卡</strong></div>
              <div className="stat-card-value"><b>{stats.cumulativeDays}</b><span>天</span></div>
              {stats.currentChecked
                ? <p>当前是第 <strong>{stats.currentDayNumber}</strong> 天</p>
                : <p>这一天还没有打卡</p>}
            </div>
          </div>
  )
  return (
    <div className="app-shell">
      <header className="hero" inert={showCompanionRecords || modal !== null}>
        <nav className="home-nav">
          <button className="brand brand-button" onClick={() => setModal('photo')} aria-label="祥字站标，点击查看赵祥照片"><span>祥</span><strong>ZX打卡</strong></button>
          <div className="header-menu" ref={headerMenuRef}>
            <button ref={headerMenuButtonRef} className="header-menu-toggle" aria-label="功能菜单" aria-expanded={headerMenuOpen} aria-controls="home-header-menu" onClick={() => setHeaderMenuOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14" /></svg>
            </button>
            {headerMenuOpen ? <div id="home-header-menu" className="header-menu-panel">
              <button onClick={() => { setHeaderMenuOpen(false); setShowCompanionRecords(true) }}><LineIcon name="activity" />查同行记录</button>
              <button onClick={() => { setHeaderMenuOpen(false); setModal('group') }}><LineIcon name="heart" />同行</button>
              <button onClick={() => { setHeaderMenuOpen(false); setModal('lookup') }}><LineIcon name="eye" />查用户</button>
              <button onClick={() => { setHeaderMenuOpen(false); setModal('calendar') }}><LineIcon name="calendar" />月历</button>
              <button onClick={() => { setHeaderMenuOpen(false); setModal('notifications') }}><LineIcon name="heart" />手机打卡提醒</button>
            </div> : null}
          </div>
        </nav>
        <div className="account-bar">
          <div className="account-person"><span>{user.displayName.slice(0, 1)}</span><div><strong>{user.displayName}</strong><small>@{user.username}</small></div></div>
          <button className="user-code" onClick={async () => { await navigator.clipboard.writeText(user.userCode).catch(() => undefined); setToast('用户码已复制') }}><small>我的用户码</small><strong>{user.userCode}</strong><span>复制</span></button>
          <span className={`sync-state ${syncState}`}>{syncState === 'loading' ? '加载中' : syncState === 'saving' ? '同步中' : syncState === 'error' ? '同步失败' : '已同步'}</span>
          <button className="logout-button" onClick={async () => { if (!demoMode) await request('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined); onLogout() }}>退出</button>
        </div>
        {sharedProfile ? <div className="viewing-banner"><span><LineIcon name="eye" />正在查看 <strong>{sharedProfile.displayName}</strong> 的记录</span><button onClick={() => setSharedProfile(null)}>返回我的记录</button></div> : null}
        <div className="hero-copy" id="top">
          <div><p className="hero-kicker">{sharedProfile ? `用户码 ${sharedProfile.userCode} · 只读查看` : '慢慢来，也是一种前进'}</p><h1>{displayDate}，<br /><em>照顾好自己。</em></h1></div>
          <div className="mobile-stats">{checkinStats}</div>
        </div>
        <div className={`progress-card ${count === 6 ? 'complete' : ''}`}>
          <div className="progress-copy"><span>{selected === today ? '今日完成度' : '当日完成度'}</span><strong>{count}<small> / 6 项</small></strong></div>
          <div className="progress-track"><i style={{ width: `${(count / 6) * 100}%` }} /></div>
          <div className="progress-result" aria-live="polite">
            {count === 6 ? <strong className="completion-badge"><span aria-hidden="true">✓</span> {selected === today ? '今日' : '当日'}已完成</strong> : null}
            <p>{count === 6 ? `${selected === today ? '今天' : '当天'}的你真棒！` : count === 0 ? '从一件小事开始记录吧' : `再完成 ${6 - count} 项，给${selected === today ? '今天' : '当天'}一个漂亮的句号`}</p>
          </div>
        </div>
      </header>
      <main className="dashboard-layout" inert={showCompanionRecords || modal !== null}>
        <aside className="desktop-stats" aria-label="打卡统计">{checkinStats}</aside>
        {!sharedProfile ? <GroupHeart members={displayedGroupMembers} selfChecked={hasAnyCheckin(records[selected])} commonCheckinDays={commonCheckinDays} currentCommonCheckinDay={displayedCurrentCommonDay} selectedIsToday={selected === today} onOpen={() => setModal('group')} onRemind={() => { if (groupMembers.length > 1) setModal('reminder'); else void remindCompanion() }} reminding={reminding} /> : null}
        {showImport && !readOnly ? <section className="import-banner"><div><strong>发现这台设备上的旧记录</strong><p>要导入到“{user.displayName}”的云端账号吗？</p></div><div><button onClick={() => { localStorage.setItem(`light-checkin-imported-${user.id}`, 'yes'); setShowImport(false) }}>暂不导入</button><button className="import-primary" onClick={() => { setRecords(legacyRecords); localStorage.setItem(`light-checkin-imported-${user.id}`, 'yes'); setShowImport(false); setToast('旧记录已导入，正在同步到云端') }}>立即导入</button></div></section> : null}
        <section className="date-section" aria-label="日期选择">
          <button className="date-arrow" onClick={() => shiftVisibleWeek(-7)} aria-label="上一周">‹</button>
          <div className="date-strip">
            {weekDates.map((date) => {
              const parsed = parseDate(date)
              const showDot = shouldShowDateDot(date, today, stats.trackingStart, visibleRecords[date])
              return <button key={date} className={`${date === selected ? 'active' : ''} ${date === today ? 'is-today' : ''}`} onClick={() => setSelected(date)}><span>{WEEKDAYS[parsed.getDay()]}</span><strong>{parsed.getDate()}</strong>{showDot ? <i className={isDayComplete(visibleRecords[date]) ? 'complete' : 'incomplete'} /> : null}</button>
            })}
          </div>
          <button className="date-arrow" onClick={() => shiftVisibleWeek(7)} aria-label="下一周">›</button>
        </section>
        {selected !== today ? <button className="back-today" onClick={returnToToday}>回到今天</button> : null}
        <section className="weight-card"><div className="weight-info"><span className="weight-icon"><LineIcon name="scale" /></span><div><p>早晨体重</p>{currentRecord.weight === null ? <h2>还没有记录</h2> : <button className="weight-value" onClick={() => setModal('chart')}><strong>{currentRecord.weight}</strong><span>斤</span><small>查看趋势 ›</small></button>}</div></div>{!readOnly ? <button className="weight-action" onClick={() => setModal('weight')}>{currentRecord.weight === null ? '记录体重' : '修改'}</button> : null}
          {recentWeights.length >= 2 ? <div className="weight-mini-chart" aria-label={`最近7天体重趋势，从${recentWeights[0].value}斤到${recentWeights[recentWeights.length - 1].value}斤`}>
            <svg viewBox="0 0 160 52" role="img" aria-label="最近7天体重折线"><polyline points={miniPoints} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>
            <div><span>{recentWeights[0].date.slice(5)} · {recentWeights[0].value}斤</span><span>{recentWeights[recentWeights.length - 1].date.slice(5)} · {recentWeights[recentWeights.length - 1].value}斤</span></div>
          </div> : null}
        </section>
        <div className="content-grid">
          <ContentCard kind="exercise" items={currentRecord.exercises} readOnly={readOnly} onAdd={() => openEntry('exercise')} onEdit={(item) => openEntry('exercise', item)} onDelete={(item) => deleteEntry('exercise', item)} />
          <ContentCard kind="food" items={currentRecord.foods} readOnly={readOnly} onAdd={() => openEntry('food')} onEdit={(item) => openEntry('food', item)} onDelete={(item) => deleteEntry('food', item)} />
          <ContentCard kind="drink" items={currentRecord.drinks ?? []} readOnly={readOnly} onAdd={() => openEntry('drink')} onEdit={(item) => openEntry('drink', item)} onDelete={(item) => deleteEntry('drink', item)}>
            <div className="water-progress">
              <div className="water-progress-label"><strong>快捷饮水 {waterCups} / 8 杯</strong><small>每杯 250 毫升，手动明细另计</small></div>
              <div className="water-cups" role="group" aria-label="快捷饮水杯数">
                {Array.from({ length: 8 }, (_, index) => <button key={index} disabled={readOnly} className={index < waterCups ? 'filled' : ''} aria-pressed={index < waterCups} aria-label={`第 ${index + 1} 杯${index < waterCups ? '，已喝' : '，未喝'}`} onClick={() => setWaterCups(index + 1 === waterCups ? index : index + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14l-2 16H7Z" /><path className="cup-water" d="M6 11h12l-1 9H7Z" /></svg><span>{index < waterCups ? '✓' : index + 1}</span></button>)}
              </div>
            </div>
          </ContentCard>
        </div>
        <section className="brush-card"><div className="card-heading"><div className="heading-with-icon"><span className="card-icon"><LineIcon name="tooth" /></span><div><p>小小习惯</p><h2>今天有好好刷牙吗？</h2></div></div><span className="brush-count">{Number(currentRecord.brushMorning) + Number(currentRecord.brushEvening)} / 2</span></div><div className="brush-options"><button disabled={readOnly} aria-pressed={currentRecord.brushMorning} className={currentRecord.brushMorning ? 'checked' : ''} onClick={() => updateRecord((record) => ({ ...record, brushMorning: !record.brushMorning }))}><span className="check-circle">{currentRecord.brushMorning ? '✓' : ''}</span><div><strong>早晨刷牙</strong><small>{currentRecord.brushMorning ? '已完成 · 清清爽爽' : '未完成 · 点击打卡'}</small></div></button><button disabled={readOnly} aria-pressed={currentRecord.brushEvening} className={currentRecord.brushEvening ? 'checked' : ''} onClick={() => updateRecord((record) => ({ ...record, brushEvening: !record.brushEvening }))}><span className="check-circle">{currentRecord.brushEvening ? '✓' : ''}</span><div><strong>晚上刷牙</strong><small>{currentRecord.brushEvening ? '已完成 · 安心入睡' : '未完成 · 点击打卡'}</small></div></button></div></section>
        <footer className="photo-gallery">
          <button className="footer-signature" onClick={() => setModal('photo')} aria-label={`查看大图：${activePhoto.title}`}>
            <img src={activePhoto.src} alt={activePhoto.alt} style={{ objectPosition: activePhoto.position }} loading="lazy" />
            <span><strong>{activePhoto.title}</strong><small>查看照片与今日寄语</small></span>
          </button>
          <div className="photo-gallery-controls" role="group" aria-label="横幅照片切换">
            <button onClick={() => changePhoto(-1)} aria-label="上一张横幅照片"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>
            <div className="photo-gallery-dots">{BANNER_PHOTOS.map((photo, index) => <button key={photo.src} onClick={() => setPhotoIndex(index)} aria-label={`查看第 ${index + 1} 张横幅照片：${photo.title}`} aria-pressed={photoIndex === index}><span /></button>)}</div>
            <span className="photo-gallery-counter" aria-live="polite">{photoIndex + 1} / {BANNER_PHOTOS.length}</span>
            <button onClick={() => changePhoto(1)} aria-label="下一张横幅照片"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>
          </div>
          <p>每一个认真生活的日子，都值得被记住。</p>
        </footer>
      </main>
      {showCompanionRecords ? <Modal wide inactive={modal !== null} className="companion-records-modal" onClose={() => setShowCompanionRecords(false)}>
        <div className="companion-records-heading"><h2>同行记录</h2><button className="icon-button" aria-label="关闭同行记录" onClick={() => setShowCompanionRecords(false)}>×</button></div>
        {companionRecordsView}
      </Modal> : null}
      {modal === 'reminder' ? <Modal onClose={() => setModal(null)}><ModalHeading eyebrow="同行爱心" title="提醒谁打卡？" onClose={() => setModal(null)} /><div className="reminder-targets">{groupMembers.map((member) => <button key={member.userCode} disabled={reminding} onClick={() => { setModal(null); void remindCompanion(member.userCode) }}><strong>{member.displayName}</strong><span>发送手机提醒</span></button>)}</div></Modal> : null}
      {modal === 'notifications' ? <PushSettings demoMode={demoMode} onClose={() => setModal(null)} /> : null}
      {modal === 'calendar' ? <CalendarModal selected={selected} records={visibleRecords} today={today} trackingStart={stats.trackingStart} onSelect={selectFromCalendar} onClose={() => setModal(null)} /> : null}
      {modal === 'weight' && !readOnly ? <WeightModal value={currentRecord.weight} onSave={(value) => { updateRecord((record) => ({ ...record, weight: value })); setModal(null) }} onClose={() => setModal(null)} /> : null}
      {modal === 'chart' ? <WeightChartModal records={visibleRecords} onClose={() => setModal(null)} /> : null}
      {modal === 'lookup' ? <LookupModal onFound={setSharedProfile} onClose={() => setModal(null)} /> : null}
      {modal === 'group' ? <GroupModal members={groupMembers} loading={groupLoading} onSave={saveGroupCodes} onClose={() => setModal(null)} /> : null}
      {modal === 'photo' ? <Modal onClose={() => setModal(null)} wide><ModalHeading eyebrow={activePhoto.title} title="今天必须开心幸福！" onClose={() => setModal(null)} />
        <figure className="photo-preview photo-gallery-preview"><img src={activePhoto.src} alt={activePhoto.alt} /><figcaption>今天必须开心幸福！</figcaption></figure>
        <div className="photo-gallery-controls" role="group" aria-label="大图照片切换"><button className="photo-gallery-text-button" onClick={() => changePhoto(-1)}>上一张</button><span aria-live="polite">{photoIndex + 1} / {BANNER_PHOTOS.length}</span><button className="photo-gallery-text-button" onClick={() => changePhoto(1)}>下一张</button></div>
      </Modal> : null}
      {(modal === 'exercise' || modal === 'food' || modal === 'drink') ? <EntryModal kind={modal} item={editingItem} onSave={(item) => saveEntry(modal, item)} onClose={() => { setModal(null); setEditingItem(undefined) }} /> : null}
      {toast ? <div className={`toast ${toast.includes('全部完成') ? 'completion-toast' : ''}`} role="status">
        <span>✓</span>
        {toast.includes('全部完成')
          ? <div><strong>{toast.startsWith('当日') ? '当日' : '今日'} 6 项全部完成</strong><small>所有项目都打卡了，做得真棒！</small></div>
          : toast}
      </div> : null}
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
