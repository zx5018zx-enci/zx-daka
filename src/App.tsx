import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
type GroupResponse = { members: GroupMember[]; commonCheckinDays: number }
type EntryKind = 'exercise' | 'food' | 'drink'
type LogKey = 'exercises' | 'foods' | 'drinks'
type LineIconName = 'activity' | 'calendar' | 'eye' | 'flame' | 'lock' | 'meal' | 'scale' | 'tooth' | 'water'
type ModalName = 'calendar' | 'weight' | 'chart' | 'lookup' | 'group' | 'photo' | EntryKind | null
type SyncState = 'loading' | 'saving' | 'saved' | 'error'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const LEGACY_STORAGE_KEY = 'light-checkin-data'
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
      <ModalHeading eyebrow="一起坚持的人" title="同行成员" onClose={onClose} />
      <p className="group-modal-intro">输入对方的用户码，任意一方添加即可同步关联；任意一方取消，双方都会解除关联。重新关联不会丢失过去的共同打卡记录。</p>
      <form className="group-add-form" onSubmit={addMember}>
        <input className="code-input" aria-label="成员用户码" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="输入 8 位用户码" maxLength={8} />
        <button className="primary-button" type="submit" disabled={saving || loading}>{saving ? '保存中…' : '添加'}</button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <p className="group-empty">正在同步成员状态…</p> : members.length === 0 ? <p className="group-empty">还没有同行成员，添加后页面才会显示月相。</p> : (
        <div className="group-member-list">
          {members.map((member) => (
            <div key={member.userCode}>
              <span className={member.checked ? 'checked' : ''}>{member.checked ? '✓' : ''}</span>
              <p><strong>{member.displayName}</strong><small>{member.userCode} · {member.checked ? '今天已打卡' : '今天未打卡'}</small></p>
              <button type="button" disabled={saving} onClick={() => removeMember(member)}>取消关联</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function GroupMoon({ members, selfChecked, commonCheckinDays, onOpen }: { members: GroupMember[]; selfChecked: boolean; commonCheckinDays: number; onOpen: () => void }) {
  if (members.length === 0) return null
  const total = members.length + 1
  const checkedCount = Number(selfChecked) + members.filter((member) => member.checked).length
  const phase = checkedCount === 0 ? 'empty' : checkedCount === total ? 'full' : 'partial'
  const message = phase === 'full'
    ? '全员完成，今晚月色正圆'
    : phase === 'empty'
      ? '今天还没有人打卡'
      : `还差 ${total - checkedCount} 人，月亮就圆满了`

  return (
    <button className={`group-moon-panel ${phase}`} onClick={onOpen} aria-label={`同行打卡：${checkedCount}/${total} 人已完成，共同打卡 ${commonCheckinDays} 天`}>
      <span className="group-moon-picture" aria-hidden="true" />
      <span className="group-moon-copy">
        <small>同行月相 · 每 30 秒更新</small>
        <strong><b>{checkedCount}</b> / {total} 人今天已打卡</strong>
        <span className="group-common-days">共同打卡 <b>{commonCheckinDays}</b> 天</span>
        <em>{message}</em>
      </span>
      <span className="group-member-dots" aria-hidden="true">
        <i className={selfChecked ? 'checked' : ''}>我</i>
        {members.slice(0, 5).map((member) => <i key={member.userCode} className={member.checked ? 'checked' : ''}>{member.displayName.slice(0, 1)}</i>)}
        {members.length > 5 ? <b>+{members.length - 5}</b> : null}
      </span>
      <span className="group-moon-arrow">管理 ›</span>
    </button>
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

function ContentCard({ kind, items, readOnly, onAdd, onEdit, onDelete }: { kind: EntryKind; items: LogItem[]; readOnly: boolean; onAdd: () => void; onEdit: (item: LogItem) => void; onDelete: (item: LogItem) => void }) {
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
      {items.length === 0 ? (
        <button className="empty-state" onClick={onAdd} disabled={readOnly}>
          <span>{config.emptyText}</span>
          <small>{readOnly ? '这一天还没有记录' : '点击添加第一条记录'}</small>
        </button>
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
          <p className="privacy-note"><LineIcon name="lock" />你的密码经过加密保存，打卡记录只有登录后才能修改。</p>
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
  { displayName: '小赵', userCode: 'MOON0002', checked: false },
]

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const today = formatDate(new Date())
  const demoParams = new URLSearchParams(window.location.search)
  const demoMode = import.meta.env.DEV && demoParams.has('demo')
  const demoWithoutGroup = demoMode && demoParams.get('group') === 'none'
  const [legacyRecords] = useState(loadLegacyRecords)
  const [records, setRecords] = useState<Records>(() => demoMode ? demoRecords() : {})
  const [loaded, setLoaded] = useState(demoMode)
  const [showImport, setShowImport] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>(demoMode ? 'saved' : 'loading')
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>(demoMode && !demoWithoutGroup ? DEMO_GROUP : [])
  const [commonCheckinDays, setCommonCheckinDays] = useState(demoMode && !demoWithoutGroup ? 2 : 0)
  const [groupLoading, setGroupLoading] = useState(!demoMode)
  const [sharedProfile, setSharedProfile] = useState<SharedProfile | null>(null)
  const [selected, setSelected] = useState(today)
  const [weekCenter, setWeekCenter] = useState(today)
  const [modal, setModal] = useState<ModalName>(null)
  const [editingItem, setEditingItem] = useState<LogItem>()
  const [toast, setToast] = useState('')
  const visibleRecords = sharedProfile?.records ?? records
  const readOnly = sharedProfile !== null
  const currentRecord = visibleRecords[selected] ?? EMPTY_RECORD
  const count = completionCount(currentRecord)
  const stats = useMemo(
    () => getCheckinStats(visibleRecords, today, selected),
    [visibleRecords, today, selected],
  )
  const weekDates = Array.from({ length: 7 }, (_, index) => shiftDate(weekCenter, index - 3))

  const refreshGroup = useCallback(async () => {
    if (demoMode) return
    try {
      const result = await request<GroupResponse>(`/api/groups?date=${today}`)
      setGroupMembers(result.members)
      setCommonCheckinDays(result.commonCheckinDays)
    } catch {
      // The group endpoint is additive; existing check-in flows stay available if it is temporarily unavailable.
    } finally {
      setGroupLoading(false)
    }
  }, [demoMode, today])

  useEffect(() => {
    void refreshGroup()
    if (demoMode) return
    const timer = window.setInterval(refreshGroup, 30_000)
    const refreshWhenVisible = () => document.visibilityState === 'visible' && void refreshGroup()
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
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
    const timer = window.setTimeout(() => setToast(''), 1800)
    return () => window.clearTimeout(timer)
  }, [toast])

  const updateRecord = (updater: (record: DayRecord) => DayRecord, message = '已自动保存') => {
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
  }
  const selectedDate = parseDate(selected)
  const displayDate = selected === today ? '今天' : `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`

  return (
    <div className="app-shell">
      <header className="hero">
        <nav>
          <button className="brand brand-button" onClick={() => setModal('photo')} aria-label="查看 ZX 赵祥高清图"><span>祥</span><strong>ZX打卡</strong></button>
          <div className="nav-actions"><button className="group-button" onClick={() => setModal('group')}>☾ 同行</button><button className="find-user-button" onClick={() => setModal('lookup')}>⌕ 查用户</button><button className="calendar-button" onClick={() => setModal('calendar')}><span>▦</span> 月历</button></div>
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
          <div className="checkin-stats">
            <div className="stat-card stat-card-streak">
              <div className="stat-card-heading"><span aria-hidden="true"><LineIcon name="flame" /></span><strong>连续打卡</strong></div>
              <div className="stat-card-value"><b>{stats.streak}</b><span>天</span></div>
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
        </div>
        <div className={`progress-card ${count === 6 ? 'complete' : ''}`}>
          <div className="progress-copy"><span>{selected === today ? '今日完成度' : '当日完成度'}</span><strong>{count}<small> / 6 项</small></strong></div>
          <div className="progress-track"><i style={{ width: `${(count / 6) * 100}%` }} /></div>
          <p>{count === 6 ? '全部完成，今天的你真棒！' : count === 0 ? '从一件小事开始记录吧' : `再完成 ${6 - count} 项，给今天一个漂亮的句号`}</p>
        </div>
      </header>
      <main>
        {!sharedProfile ? <GroupMoon members={groupMembers} selfChecked={hasAnyCheckin(records[today])} commonCheckinDays={commonCheckinDays} onOpen={() => setModal('group')} /> : null}
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
        <section className="weight-card"><div className="weight-info"><span className="weight-icon"><LineIcon name="scale" /></span><div><p>早晨体重</p>{currentRecord.weight === null ? <h2>还没有记录</h2> : <button className="weight-value" onClick={() => setModal('chart')}><strong>{currentRecord.weight}</strong><span>斤</span><small>查看趋势 ›</small></button>}</div></div>{!readOnly ? <button className="weight-action" onClick={() => setModal('weight')}>{currentRecord.weight === null ? '记录体重' : '修改'}</button> : null}</section>
        <div className="content-grid">
          <ContentCard kind="exercise" items={currentRecord.exercises} readOnly={readOnly} onAdd={() => openEntry('exercise')} onEdit={(item) => openEntry('exercise', item)} onDelete={(item) => deleteEntry('exercise', item)} />
          <ContentCard kind="food" items={currentRecord.foods} readOnly={readOnly} onAdd={() => openEntry('food')} onEdit={(item) => openEntry('food', item)} onDelete={(item) => deleteEntry('food', item)} />
          <ContentCard kind="drink" items={currentRecord.drinks ?? []} readOnly={readOnly} onAdd={() => openEntry('drink')} onEdit={(item) => openEntry('drink', item)} onDelete={(item) => deleteEntry('drink', item)} />
        </div>
        <section className="brush-card"><div className="card-heading"><div className="heading-with-icon"><span className="card-icon"><LineIcon name="tooth" /></span><div><p>小小习惯</p><h2>今天有好好刷牙吗？</h2></div></div><span className="brush-count">{Number(currentRecord.brushMorning) + Number(currentRecord.brushEvening)} / 2</span></div><div className="brush-options"><button disabled={readOnly} className={currentRecord.brushMorning ? 'checked' : ''} onClick={() => updateRecord((record) => ({ ...record, brushMorning: !record.brushMorning }))}><span className="check-circle">{currentRecord.brushMorning ? '✓' : ''}</span><div><strong>早晨刷牙</strong><small>清清爽爽开启一天</small></div></button><button disabled={readOnly} className={currentRecord.brushEvening ? 'checked' : ''} onClick={() => updateRecord((record) => ({ ...record, brushEvening: !record.brushEvening }))}><span className="check-circle">{currentRecord.brushEvening ? '✓' : ''}</span><div><strong>晚上刷牙</strong><small>干干净净进入梦乡</small></div></button></div></section>
        <footer><button className="footer-signature" onClick={() => setModal('photo')}><img src="/zx-footer-icon.png?v=1" alt="" /><span><strong>ZX 赵祥</strong><small>查看今日寄语</small></span></button><p>每一个认真生活的日子，都值得被记住。</p></footer>
      </main>
      {modal === 'calendar' ? <CalendarModal selected={selected} records={visibleRecords} today={today} trackingStart={stats.trackingStart} onSelect={selectFromCalendar} onClose={() => setModal(null)} /> : null}
      {modal === 'weight' && !readOnly ? <WeightModal value={currentRecord.weight} onSave={(value) => { updateRecord((record) => ({ ...record, weight: value })); setModal(null) }} onClose={() => setModal(null)} /> : null}
      {modal === 'chart' ? <WeightChartModal records={visibleRecords} onClose={() => setModal(null)} /> : null}
      {modal === 'lookup' ? <LookupModal onFound={setSharedProfile} onClose={() => setModal(null)} /> : null}
      {modal === 'group' ? <GroupModal members={groupMembers} loading={groupLoading} onSave={saveGroupCodes} onClose={() => setModal(null)} /> : null}
      {modal === 'photo' ? <Modal onClose={() => setModal(null)} wide><ModalHeading eyebrow="ZX 赵祥" title="今天必须开心幸福！" onClose={() => setModal(null)} /><figure className="photo-preview"><img src="/zx-zhaoxiang-photo.png?v=1" alt="ZX 赵祥运动主题高清图" /><figcaption>今天必须开心幸福！</figcaption></figure></Modal> : null}
      {(modal === 'exercise' || modal === 'food' || modal === 'drink') ? <EntryModal kind={modal} item={editingItem} onSave={(item) => saveEntry(modal, item)} onClose={() => { setModal(null); setEditingItem(undefined) }} /> : null}
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
