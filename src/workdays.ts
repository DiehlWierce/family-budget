/**
 * Производственный календарь.
 *
 * Праздники в России фиксированные, а переносы каждый год утверждает постановление,
 * поэтому базовое правило («праздник на выходном сдвигает ближайший рабочий день»)
 * даёт верный ответ почти всегда, но не всегда. Точечные расхождения — в calendar.json:
 * из 77 реальных получек правило промахнулось ровно дважды, оба раза в конце декабря.
 */

/**
 * Рабочие дни месяца, вбитые руками. Ключ — «2026-09».
 * norm — норма месяца, first — рабочие дни с 1 по 15, second — с 16 по конец.
 * null или отсутствие значения означает «считай по календарю».
 */
export interface MonthWorkdays {
  norm?: number | null
  first?: number | null
  second?: number | null
}

export interface CalendarOverrides {
  /** Дни, которые правило считает рабочими, а на деле они выходные. */
  extraHolidays: string[]
  /** Дни, которые правило считает выходными, а на деле рабочие. */
  extraWorkdays: string[]
  /** Ручная таблица рабочих дней — она сильнее любого расчёта. */
  months?: Record<string, MonthWorkdays>
}

export const EMPTY_CALENDAR: CalendarOverrides = { extraHolidays: [], extraWorkdays: [] }

export const monthKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}`

/** Ручное значение для месяца — или null, если его не вводили. */
export function manualWorkdays(
  year: number, month: number, field: keyof MonthWorkdays, cal?: CalendarOverrides,
): number | null {
  const row = cal?.months?.[monthKey(year, month)]
  const v = row?.[field]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const FIXED: [number, number][] = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8],
  [2, 23], [3, 8], [5, 1], [5, 9], [6, 12], [11, 4],
]

export const iso = (d: Date) => {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export const parse = (s: string) => new Date(s + 'T00:00:00')

const holidayCache = new Map<number, Set<string>>()

function holidaysOf(year: number): Set<string> {
  const hit = holidayCache.get(year)
  if (hit) return hit
  const days = new Set<string>()
  for (const [m, d] of FIXED) days.add(iso(new Date(year, m - 1, d)))
  // Праздник, выпавший на выходной, переносится на ближайший рабочий день.
  for (const key of [...days].sort()) {
    const d = parse(key)
    if (d.getDay() !== 0 && d.getDay() !== 6) continue
    const c = new Date(d)
    for (let guard = 0; guard < 20; guard++) {
      c.setDate(c.getDate() + 1)
      const k = iso(c)
      if (c.getDay() !== 0 && c.getDay() !== 6 && !days.has(k)) { days.add(k); break }
    }
  }
  holidayCache.set(year, days)
  return days
}

export function isWorkday(date: Date, cal: CalendarOverrides = EMPTY_CALENDAR): boolean {
  const key = iso(date)
  if (cal.extraWorkdays.includes(key)) return true
  if (cal.extraHolidays.includes(key)) return false
  if (date.getDay() === 0 || date.getDay() === 6) return false
  return !holidaysOf(date.getFullYear()).has(key)
}

/** Рабочие дни в диапазоне включительно. */
export function workdaysBetween(from: Date, to: Date, cal?: CalendarOverrides): number {
  let n = 0
  const c = new Date(from)
  while (c <= to) {
    if (isWorkday(c, cal)) n++
    c.setDate(c.getDate() + 1)
  }
  return n
}

export const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate()

export function workdaysInMonth(year: number, month: number, cal?: CalendarOverrides): number {
  return workdaysBetween(new Date(year, month - 1, 1), new Date(year, month - 1, daysInMonth(year, month)), cal)
}

/** Рабочие дни половины месяца по календарю: 'first' — 1–15, 'second' — 16 и дальше. */
export function halfWorkdaysByCalendar(
  year: number, month: number, half: 'first' | 'second', cal?: CalendarOverrides,
): number {
  const from = new Date(year, month - 1, half === 'first' ? 1 : 16)
  const to = new Date(year, month - 1, half === 'first' ? 15 : daysInMonth(year, month))
  return workdaysBetween(from, to, cal)
}

/** Ближайший рабочий день не позже указанного — зарплату двигают назад, а не вперёд. */
export function payDate(year: number, month: number, day: number, cal?: CalendarOverrides): string {
  const d = new Date(year, month - 1, day)
  for (let guard = 0; guard < 30 && !isWorkday(d, cal); guard++) d.setDate(d.getDate() - 1)
  return iso(d)
}
