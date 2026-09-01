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

export interface SalaryConfig {
  history: SalaryStep[]
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

/**
 * Оклад, действующий на дату: последняя запись, начавшаяся не позже неё.
 * Ничего не досочиняем — вперёд действует тот оклад, что вбит руками.
 */
export function monthlyAt(date: string, cfg: SalaryConfig): number {
  const steps = [...(cfg.history ?? [])].sort((a, z) => a.from.localeCompare(z.from))
  let base = steps[0]
  for (const s of steps) if (s.from <= date) base = s
  return base?.monthly ?? 0
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
