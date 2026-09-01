import type { Paycheck } from './types'
import {
  type CalendarOverrides, daysInMonth, halfWorkdaysByCalendar, manualWorkdays, workdaysInMonth,
} from './workdays'

export interface SalaryStep {
  /** Действует для периодов, начинающихся с этой даты. */
  from: string
  monthly: number
  note?: string
}

export interface Indexation {
  enabled: boolean
  /** Месяц, с первого числа которого поднимается оклад. */
  month: number
  percent: number
}

export interface SalaryConfig {
  history: SalaryStep[]
  indexation: Indexation
}

/**
 * Период начисления. Получка 21-го — за первую половину этого месяца,
 * получка 6-го — за вторую половину предыдущего.
 */
export function accrualPeriod(p: Pick<Paycheck, 'periodYear' | 'periodMonth' | 'slot'>) {
  if (p.slot === 2) {
    return { year: p.periodYear, month: p.periodMonth, fromDay: 1, toDay: 15 }
  }
  const month = p.periodMonth === 1 ? 12 : p.periodMonth - 1
  const year = p.periodMonth === 1 ? p.periodYear - 1 : p.periodYear
  return { year, month, fromDay: 16, toDay: daysInMonth(year, month) }
}

/** Оклад, действующий на дату, с учётом ежегодной индексации после последней записи. */
export function monthlyAt(date: string, cfg: SalaryConfig): number {
  const steps = [...cfg.history].sort((a, z) => a.from.localeCompare(z.from))
  let base = steps[0]
  for (const s of steps) if (s.from <= date) base = s
  if (!base) return 0
  let value = base.monthly
  if (!cfg.indexation.enabled) return value

  // Каждое наступившее с момента base.from первое число месяца индексации поднимает оклад.
  const start = new Date(base.from + 'T00:00:00')
  const target = new Date(date + 'T00:00:00')
  let year = start.getFullYear()
  for (let guard = 0; guard < 60; guard++) {
    const point = new Date(year, cfg.indexation.month - 1, 1)
    if (point > target) break
    if (point > start) value = Math.round(value * (1 + cfg.indexation.percent / 100))
    year += 1
  }
  return value
}

export interface SalaryCalc {
  amount: number
  monthly: number
  workdays: number
  normWorkdays: number
  periodLabel: string
  /** Рабочие дни взяты из таблицы в настройках, а не посчитаны по календарю. */
  manual: boolean
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

export function computeSalary(
  p: Pick<Paycheck, 'periodYear' | 'periodMonth' | 'slot'>,
  cfg: SalaryConfig,
  cal?: CalendarOverrides,
): SalaryCalc {
  const per = accrualPeriod(p)
  const half = per.fromDay === 1 ? 'first' : 'second'
  // Вбитое руками важнее расчёта: производственный календарь знает не всё.
  const manualDays = manualWorkdays(per.year, per.month, half, cal)
  const manualNorm = manualWorkdays(per.year, per.month, 'norm', cal)
  const workdays = manualDays ?? halfWorkdaysByCalendar(per.year, per.month, half, cal)
  const normWorkdays = manualNorm ?? workdaysInMonth(per.year, per.month, cal)
  const monthly = monthlyAt(`${per.year}-${String(per.month).padStart(2, '0')}-01`, cfg)
  const amount = normWorkdays ? Math.round((monthly / normWorkdays) * workdays) : 0
  return {
    amount, monthly, workdays, normWorkdays,
    manual: manualDays !== null || manualNorm !== null,
    periodLabel: `${per.fromDay}–${per.toDay} ${MONTHS_GEN[per.month - 1]} ${per.year}`,
  }
}

/** Итоговый план получки: ручное значение важнее расчёта. */
export function salaryPlan(p: Paycheck, cfg: SalaryConfig, cal?: CalendarOverrides): number {
  return p.salaryOverride ?? computeSalary(p, cfg, cal).amount
}

export const effectiveSalary = (p: Paycheck, cfg: SalaryConfig, cal?: CalendarOverrides): number =>
  p.salaryFact ?? salaryPlan(p, cfg, cal)
