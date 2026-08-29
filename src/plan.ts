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

export type TemplateChange = 'upsert' | 'remove'

export interface TemplateSync {
  entries: Entry[]
  touched: number
}

/**
 * Попадает ли шаблон в эту получку по смыслу — без учёта дат действия.
 * Даты здесь не спрашиваем: «применить с такой-то получки» и есть ответ про даты.
 */
const covers = (t: Template, p: Paycheck) =>
  (t.slot === 'both' || t.slot === p.slot) && (t.freq !== 'yearly' || t.month === p.periodMonth)

/**
 * Тянет правку шаблона в уже расписанные получки, начиная с fromPaycheckId.
 * Раньше этой получки не трогает ничего: там записанная история.
 * Факт не переписываем — план подтягиваем только там, где факта ещё нет.
 */
export function applyTemplate(
  budget: Budget,
  template: Template,
  fromPaycheckId: string,
  change: TemplateChange,
  prev?: Template,
): TemplateSync {
  const was = prev ?? template
  // Пустое название ничего не опознаёт: только что добавленный шаблон ищем строго по id.
  const matchable = was.title.trim().length > 0
  const byId = new Map(budget.paychecks.map((p) => [p.id, p]))
  const kept: Entry[] = []
  const covered = new Set<string>()
  let touched = 0

  for (const e of budget.entries) {
    const p = byId.get(e.paycheckId)
    if (!p || p.id < fromPaycheckId) { kept.push(e); continue }

    const own = e.templateId === template.id
    // Строки из таблицы про шаблон не знают — опознаём по названию. Но «Ипотека» первой
    // получки и «Ипотека» второй — разные шаблоны, и ежегодное «На ВБ» в мае не имеет
    // отношения к февральскому. Поэтому сверяемся с тем, каким шаблон был до правки.
    const legacy = !e.templateId && matchable
      && e.title === was.title && e.kind === was.kind && covers(was, p)
    if (!own && !legacy) { kept.push(e); continue }

    // Убрали шаблон — или он больше не попадает в эту получку (сменились получка / месяц).
    if (change === 'remove' || !templateApplies(template, p)) { touched++; continue }
    covered.add(p.id)
    touched++
    kept.push({
      ...e,
      templateId: template.id,
      title: template.title,
      categoryId: template.categoryId,
      kind: template.kind,
      plan: e.fact === null ? template.amount : e.plan,
    })
  }

  if (change === 'upsert') {
    for (const p of budget.paychecks) {
      if (p.id < fromPaycheckId || covered.has(p.id)) continue
      if (!templateApplies(template, p)) continue
      touched++
      kept.push({
        id: `${p.id}-t-${template.id}`,
        paycheckId: p.id,
        templateId: template.id,
        kind: template.kind,
        categoryId: template.categoryId,
        title: template.title,
        plan: template.amount,
        fact: null,
        order: template.order,
      })
    }
  }

  return { entries: kept, touched }
}

/**
 * Меняет местами два соседних элемента, раздавая по кругу их же значения order.
 * Так перестановка внутри секции не задевает порядок соседних секций.
 */
export function swapOrder<T extends { id: string; order: number }>(
  all: T[],
  group: T[],
  id: string,
  dir: -1 | 1,
): T[] {
  const sorted = [...group].sort((a, z) => a.order - z.order)
  const i = sorted.findIndex((x) => x.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= sorted.length) return all

  const ids = sorted.map((x) => x.id)
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  let orders = sorted.map((x) => x.order).sort((a, z) => a - z)
  // Одинаковые order встречаются в перенесённых из таблицы строках: по кругу их раздавать
  // бессмысленно — перестановка не была бы видна. Тогда нумеруем секцию заново.
  if (new Set(orders).size !== orders.length) orders = orders.map((_, k) => orders[0] + k)
  const next = new Map(ids.map((x, k) => [x, orders[k]]))
  return all.map((x) => (next.has(x.id) ? { ...x, order: next.get(x.id)! } : x))
}
