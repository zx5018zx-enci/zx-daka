export type LogItem = {
  id: string
  name: string
  amount: string
}

export type DayRecord = {
  weight: number | null
  exercises: LogItem[]
  foods: LogItem[]
  drinks: LogItem[]
  brushMorning: boolean
  brushEvening: boolean
}

export type Records = Record<string, DayRecord>

export const EMPTY_RECORD: DayRecord = {
  weight: null,
  exercises: [],
  foods: [],
  drinks: [],
  brushMorning: false,
  brushEvening: false,
}

export const createEmptyRecord = (): DayRecord => ({
  ...EMPTY_RECORD,
  exercises: [],
  foods: [],
  drinks: [],
})

export const hasAnyCheckin = (record?: DayRecord): boolean =>
  Boolean(
    record &&
      (record.weight !== null ||
        record.exercises.length > 0 ||
        record.foods.length > 0 ||
        Boolean(record.drinks?.length) ||
        record.brushMorning ||
        record.brushEvening),
  )

export const isDayComplete = (record?: DayRecord): boolean =>
  Boolean(
    record &&
      record.weight !== null &&
      record.exercises.length > 0 &&
      record.foods.length > 0 &&
      Boolean(record.drinks?.length) &&
      record.brushMorning &&
      record.brushEvening,
  )

export const completionCount = (record: DayRecord): number =>
  [
    record.weight !== null,
    record.exercises.length > 0,
    record.foods.length > 0,
    Boolean(record.drinks?.length),
    record.brushMorning,
    record.brushEvening,
  ].filter(Boolean).length

export const padDatePart = (value: number): string => String(value).padStart(2, '0')

export const formatDate = (date: Date): string =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`

export const parseDate = (value: string): Date => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export const shiftDate = (value: string, days: number): string => {
  const date = parseDate(value)
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

export const getCheckinStats = (records: Records, today: string, currentDate = today) => {
  const checkedDates = Object.keys(records)
    .filter((date) => hasAnyCheckin(records[date]))
    .sort()

  let streakCursor = hasAnyCheckin(records[today]) ? today : shiftDate(today, -1)
  let streak = 0
  while (hasAnyCheckin(records[streakCursor])) {
    streak += 1
    streakCursor = shiftDate(streakCursor, -1)
  }

  const checkedBeforeCurrentDate = checkedDates.filter((date) => date < currentDate).length
  const currentDayNumber = checkedBeforeCurrentDate + 1
  const currentChecked = hasAnyCheckin(records[currentDate])

  return {
    streak,
    cumulativeDays: checkedDates.length,
    currentDayNumber,
    currentChecked,
    trackingStart: checkedDates[0] ?? today,
  }
}

export const shouldShowDateDot = (date: string, today: string, trackingStart: string, record?: DayRecord): boolean =>
  date <= today && date >= trackingStart && hasAnyCheckin(record)
