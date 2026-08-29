import type { Budget, Entry, Paycheck, Template } from './types'
import { payDate, type CalendarOverrides } from './workdays'

export const paycheckId = (year: number, month: number, slot: 1 | 2) =>
  `${year}-${String(month).padStart(2, '0')}-${slot}`

/** id получек упорядочены лексикографически, поэтому сравнивать можно строками. */
export const inRange = (id: string, from: string, to: string | null) =>
  id >= from && (to === null || id <= to)

export function templateApplies(t: Template, p: Paycheck): boolean {
  if (!inRange(p.id, t.from, t.to)) return false
  if (t.slot !== 'both' && t.slot !== p.slot) return false
  if (t.freq === 'yearly' && t.month !== p.periodMonth) return false
  return true
}

export interface Generated {
  paychecks: Paycheck[]
  entries: Entry[]
}

/**
 * Дотягивает план до конца horizonYear: создаёт недостающие получки
 * и наполняет их строками из шаблонов. Уже существующие получки не трогает.
 */
export function extendPlan(
  budget: Budget,
  horizonYear: number,
  cal: CalendarOverrides,
): Generated {
  const known = new Set(budget.paychecks.map((p) => p.id))
  const last = budget.paychecks[budget.paychecks.length - 1]
  if (!last) return { paychecks: [], entries: [] }

  const paychecks: Paycheck[] = []
  const entries: Entry[] = []

  let year = last.periodYear
  let month = last.periodMonth
  for (let guard = 0; guard < 12 * 30; guard++) {
    month += 1
    if (month > 12) { month = 1; year += 1 }
    if (year > horizonYear) break

    for (const slot of [1, 2] as const) {
      const id = paycheckId(year, month, slot)
      if (known.has(id)) continue
      const paycheck: Paycheck = {
        id,
        date: payDate(year, month, slot === 1 ? 6 : 21, cal),
        periodYear: year,
        periodMonth: month,
        slot,
        salaryOverride: null,
        salaryFact: null,
        generated: true,
      }
      paychecks.push(paycheck)
      entries.push(...materialize(paycheck, budget.templates))
    }
  }
  return { paychecks, entries }
}

/** Строки одной получки по шаблонам. */
export function materialize(paycheck: Paycheck, templates: Template[]): Entry[] {
  return templates
    .filter((t) => templateApplies(t, paycheck))
    .sort((a, z) => a.order - z.order)
    .map((t) => ({
      id: `${paycheck.id}-t-${t.id}`,
      paycheckId: paycheck.id,
      templateId: t.id,
      kind: t.kind,
      categoryId: t.categoryId,
      title: t.title,
      plan: t.amount,
      fact: null,
      order: t.order,
    }))
}

/** Совпадает ли строка с образцом: по шаблону, иначе по названию и типу. */
const sameRow = (a: Entry, b: Entry) =>
  a.templateId && b.templateId ? a.templateId === b.templateId : a.title === b.title && a.kind === b.kind

export interface ForwardResult {
  entries: Entry[]
  templates: Template[]
  touched: number
}

/**
 * Переносит правку строки на все последующие получки того же типа (первая / вторая).
 * Прошлое не трогает никогда: это записанная история.
 */
export function applyForward(
  budget: Budget,
  fromPaycheckId: string,
  sample: Entry,
  change: 'amount' | 'add' | 'remove',
): ForwardResult {
  const from = budget.paychecks.find((p) => p.id === fromPaycheckId)
  if (!from) return { entries: budget.entries, templates: budget.templates, touched: 0 }

  const targets = budget.paychecks.filter((p) => p.id > fromPaycheckId && p.slot === from.slot)
  const targetIds = new Set(targets.map((p) => p.id))
  let touched = 0
  let entries = budget.entries

  if (change === 'remove') {
    entries = entries.filter((e) => {
      const hit = targetIds.has(e.paycheckId) && sameRow(e, sample)
      if (hit) touched++
      return !hit
    })
  } else {
    entries = entries.map((e) => {
      if (!targetIds.has(e.paycheckId) || !sameRow(e, sample)) return e
      touched++
      // Факт — это то, что уже случилось; правка плана его не переписывает.
      return { ...e, plan: sample.plan, title: sample.title, categoryId: sample.categoryId }
    })
    if (change === 'add') {
      const missing = targets.filter(
        (p) => !entries.some((e) => e.paycheckId === p.id && sameRow(e, sample)),
      )
      for (const p of missing) {
        touched++
        entries = [...entries, {
          ...sample,
          id: `${p.id}-add-${sample.templateId ?? sample.order}`,
          paycheckId: p.id,
          fact: null,
        }]
      }
    }
  }

  return { entries, templates: syncTemplates(budget.templates, from, sample, change), touched }
}

/** Шаблон нужен, чтобы правка попала и в получки, которых ещё нет. */
function syncTemplates(
  templates: Template[],
  from: Paycheck,
  sample: Entry,
  change: 'amount' | 'add' | 'remove',
): Template[] {
  const match = (t: Template) =>
    sample.templateId ? t.id === sample.templateId
      : t.title === sample.title && t.kind === sample.kind && (t.slot === 'both' || t.slot === from.slot)

  if (change === 'remove') {
    // Шаблон не удаляем — закрываем задним числом, чтобы прошлые получки остались как были.
    return templates.map((t) => (match(t) ? { ...t, to: previousId(from) } : t))
  }
  if (templates.some(match)) {
    return templates.map((t) => (match(t) ? { ...t, amount: sample.plan ?? 0, title: sample.title } : t))
  }
  const order = sample.order
  return [...templates, {
    id: `tpl-${Date.now().toString(36)}`,
    title: sample.title,
    categoryId: sample.categoryId,
    kind: sample.kind === 'income' ? 'optional' : sample.kind,
    amount: sample.plan ?? 0,
    slot: from.slot,
    freq: 'each',
    from: from.id,
    to: null,
    order,
  }]
}

const previousId = (p: Paycheck) => {
  if (p.slot === 2) return paycheckId(p.periodYear, p.periodMonth, 1)
  const month = p.periodMonth === 1 ? 12 : p.periodMonth - 1
  const year = p.periodMonth === 1 ? p.periodYear - 1 : p.periodYear
  return paycheckId(year, month, 2)
}
