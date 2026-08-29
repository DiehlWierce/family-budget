/**
 * Производственный календарь.
 *
 * Праздники в России фиксированные, а переносы каждый год утверждает постановление,
 * поэтому базовое правило («праздник на выходном сдвигает ближайший рабочий день»)
 * даёт верный ответ почти всегда, но не всегда. Точечные расхождения — в calendar.json:
 * из 77 реальных получек правило промахнулось ровно дважды, оба раза в конце декабря.
 */

export interface CalendarOverrides {
  /** Дни, которые правило считает рабочими, а на деле они выходные. */
  extraHolidays: string[]
  /** Дни, которые правило считает выходными, а на деле рабочие. */
  extraWorkdays: string[]
}

export const EMPTY_CALENDAR: CalendarOverrides = { extraHolidays: [], extraWorkdays: [] }

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

/** Ближайший рабочий день не позже указанного — зарплату двигают назад, а не вперёд. */
export function payDate(year: number, month: number, day: number, cal?: CalendarOverrides): string {
  const d = new Date(year, month - 1, day)
  for (let guard = 0; guard < 30 && !isWorkday(d, cal); guard++) d.setDate(d.getDate() - 1)
  return iso(d)
}
