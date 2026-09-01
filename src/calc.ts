import type { Budget, Category, Entry, Paycheck } from './types'
import { today } from './format'
import { effectiveSalary } from './salary'

/** Сколько строка реально стоит: факт, если проставлен, иначе план. */
export const actual = (e: Entry) => e.fact ?? e.plan ?? 0
export const planned = (e: Entry) => e.plan ?? 0

export interface Totals {
  /** Зарплата плюс все приходы. */
  income: number
  salary: number
  extraIncome: number
  /** Сколько расписано планом. */
  plannedOut: number
  /** С учётом проставленных фактов. */
  actualOut: number
  required: number
  optional: number
  /** Уже точно потрачено — строки с фактом. */
  spent: number
  /** Осталось оплатить — строки без факта. */
  toPay: number
  free: number
}

export function totals(paycheck: Paycheck, b: Budget): Totals {
  const mine = b.entries.filter((e) => e.paycheckId === paycheck.id)
  const salary = effectiveSalary(paycheck, b.salary, b.calendar)
  const extraIncome = mine.filter((e) => e.kind === 'income').reduce((s, e) => s + actual(e), 0)
  const out = mine.filter((e) => e.kind !== 'income')
  const required = out.filter((e) => e.kind === 'required').reduce((s, e) => s + actual(e), 0)
  const optional = out.filter((e) => e.kind === 'optional').reduce((s, e) => s + actual(e), 0)
  const spent = out.filter((e) => e.fact !== null).reduce((s, e) => s + (e.fact ?? 0), 0)
  const toPay = out.filter((e) => e.fact === null).reduce((s, e) => s + planned(e), 0)
  const income = salary + extraIncome
  return {
    income, salary, extraIncome,
    plannedOut: out.reduce((s, e) => s + planned(e), 0),
    actualOut: required + optional,
    required, optional, spent, toPay,
    free: income - required - optional,
  }
}

export function currentPaycheckId(paychecks: Paycheck[], now = today()): string | null {
  const past = paychecks.filter((p) => p.date <= now)
  if (past.length) return past[past.length - 1].id
  return paychecks[0]?.id ?? null
}

export function nextPaycheck(paychecks: Paycheck[], afterId: string): Paycheck | null {
  const i = paychecks.findIndex((p) => p.id === afterId)
  return i >= 0 && i + 1 < paychecks.length ? paychecks[i + 1] : null
}

export const byId = <T extends { id: string }>(list: T[]) =>
  Object.fromEntries(list.map((x) => [x.id, x])) as Record<string, T>

export const DEBT_GROUP = 'debt'
/** Сборная категория разовых погашений — в нагрузку входит, отдельным кредитом не считается. */
const NOT_A_LOAN = new Set(['debt-extra'])

export interface YearStat {
  year: number
  income: number
  required: number
  optional: number
  debt: number
  debtShare: number
  negatives: number
  paychecks: number
}

export function yearStats(b: Budget): YearStat[] {
  const cats = byId(b.categories)
  const map = new Map<number, YearStat>()
  for (const p of b.paychecks) {
    const t = totals(p, b)
    const y = p.periodYear
    const s = map.get(y) ?? {
      year: y, income: 0, required: 0, optional: 0, debt: 0, debtShare: 0, negatives: 0, paychecks: 0,
    }
    s.income += t.income
    s.required += t.required
    s.optional += t.optional
    s.paychecks += 1
    if (t.free < 0) s.negatives += 1
    for (const e of b.entries) {
      if (e.paycheckId !== p.id || e.kind === 'income') continue
      if (cats[e.categoryId]?.group === DEBT_GROUP) s.debt += actual(e)
    }
    map.set(y, s)
  }
  const out = [...map.values()].sort((a, z) => a.year - z.year)
  for (const s of out) s.debtShare = s.income ? s.debt / s.income : 0
  return out
}

export interface CategoryStat {
  category: Category
  plan: number
  fact: number
  pairs: number
  total: number
  deviation: number
}

/** Отклонение факта от плана — только по строкам, где заполнено и то и другое. */
export function categoryStats(b: Budget, year: number | 'all'): CategoryStat[] {
  const cats = byId(b.categories)
  const inYear = new Set(
    b.paychecks.filter((p) => year === 'all' || p.periodYear === year).map((p) => p.id),
  )
  const map = new Map<string, CategoryStat>()
  for (const e of b.entries) {
    if (!inYear.has(e.paycheckId) || e.kind === 'income') continue
    const cat = cats[e.categoryId]
    if (!cat) continue
    const s = map.get(cat.id) ?? { category: cat, plan: 0, fact: 0, pairs: 0, total: 0, deviation: 0 }
    s.total += actual(e)
    if (e.plan !== null && e.fact !== null) {
      s.plan += e.plan
      s.fact += e.fact
      s.pairs += 1
    }
    map.set(cat.id, s)
  }
  const out = [...map.values()]
  for (const s of out) s.deviation = s.plan ? (s.fact - s.plan) / s.plan : 0
  return out.sort((a, z) => z.total - a.total)
}

export interface GroupStat { id: string; name: string; total: number }

export function groupStats(b: Budget, year: number | 'all'): GroupStat[] {
  const stats = categoryStats(b, year)
  const names = byId(b.groups)
  const map = new Map<string, GroupStat>()
  for (const s of stats) {
    const g = s.category.group
    const item = map.get(g) ?? { id: g, name: names[g]?.name ?? s.category.groupName, total: 0 }
    item.total += s.total
    map.set(g, item)
  }
  return [...map.values()].sort((a, z) => z.total - a.total)
}

export interface DebtStat {
  category: Category
  monthly: number
  paid: number
  remaining: number
  lastDate: string
  active: boolean
}

/** Кредиты: сколько платим сейчас, сколько ещё расписано и когда последний платёж. */
export function debtStats(b: Budget, now = today()): DebtStat[] {
  const cats = byId(b.categories)
  const pay = byId(b.paychecks)
  const map = new Map<string, DebtStat>()
  for (const e of b.entries) {
    const cat = cats[e.categoryId]
    if (!cat || cat.group !== DEBT_GROUP || NOT_A_LOAN.has(cat.id) || e.kind === 'income') continue
    const p = pay[e.paycheckId]
    if (!p) continue
    const amount = actual(e)
    if (!amount) continue
    const s = map.get(cat.id) ?? {
      category: cat, monthly: 0, paid: 0, remaining: 0, lastDate: p.date, active: false,
    }
    if (p.date <= now) s.paid += amount
    else s.remaining += amount
    if (p.date > s.lastDate) s.lastDate = p.date
    map.set(cat.id, s)
  }
  const out = [...map.values()]
  for (const s of out) {
    s.active = s.lastDate >= now
    // Платёж в месяц — по последним начислениям этого кредита.
    const recent = b.entries
      .filter((e) => e.categoryId === s.category.id && actual(e) > 0 && pay[e.paycheckId])
      .sort((a, z) => pay[z.paycheckId].date.localeCompare(pay[a.paycheckId].date))
      .slice(0, 2)
    s.monthly = recent.length ? actual(recent[0]) : 0
  }
  return out.sort((a, z) => Number(z.active) - Number(a.active) || z.remaining - a.remaining)
}

export interface MonthStat {
  key: string
  year: number
  month: number
  income: number
  required: number
  optional: number
  free: number
  paychecks: Paycheck[]
}

/** Месяц целиком: обе получки вместе. Так месяцы сравниваются между собой. */
export function monthStats(b: Budget, year: number | 'all'): MonthStat[] {
  const map = new Map<string, MonthStat>()
  for (const p of b.paychecks) {
    if (year !== 'all' && p.periodYear !== year) continue
    const key = `${p.periodYear}-${String(p.periodMonth).padStart(2, '0')}`
    const s = map.get(key) ?? {
      key, year: p.periodYear, month: p.periodMonth,
      income: 0, required: 0, optional: 0, free: 0, paychecks: [],
    }
    const t = totals(p, b)
    s.income += t.income
    s.required += t.required
    s.optional += t.optional
    s.free += t.free
    s.paychecks.push(p)
    map.set(key, s)
  }
  return [...map.values()].sort((a, z) => a.key.localeCompare(z.key))
}
