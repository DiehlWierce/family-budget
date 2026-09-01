import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import type {
  Budget, CalendarOverrides, Category, Entry, GithubConfig, Group, Paycheck, SalaryConfig, Template,
} from './types'
import { commitFiles } from './github'
import { applyForward, applyTemplate, extendPlan, reorderList, type TemplateChange } from './plan'

const DRAFT_KEY = 'fb.draft.v1'
const GH_KEY = 'fb.github.v1'
const DATA_FILES = ['meta', 'paychecks', 'entries', 'categories', 'groups',
  'templates', 'salary', 'calendar'] as const
/** Глубина «Назад». Снимки делят между собой неизменённые строки, память не растёт. */
const HISTORY_LIMIT = 40

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'published'; at: string }
  | { kind: 'error'; message: string }

interface Draft {
  remoteUpdatedAt: string
  dirty: boolean
  budget: Budget
}

interface Snapshot {
  label: string
  budget: Budget
}

export const loadGithubConfig = (): GithubConfig => {
  try {
    const raw = localStorage.getItem(GH_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* localStorage может быть недоступен */ }
  return { owner: '', repo: '', branch: 'main', token: '' }
}

export const saveGithubConfig = (cfg: GithubConfig) => {
  try { localStorage.setItem(GH_KEY, JSON.stringify(cfg)) } catch { /* игнорируем */ }
}

const readDraft = (): Draft | null => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as Draft) : null
  } catch { return null }
}

const writeDraft = (draft: Draft | null) => {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    else localStorage.removeItem(DRAFT_KEY)
  } catch { /* игнорируем */ }
}

async function fetchBudget(): Promise<Budget> {
  const base = import.meta.env.BASE_URL
  const bust = `?v=${Date.now()}`
  const parts = await Promise.all(
    DATA_FILES.map(async (name) => {
      const res = await fetch(`${base}data/${name}.json${bust}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`не читается data/${name}.json (${res.status})`)
      return [name, await res.json()] as const
    }),
  )
  return normalize(Object.fromEntries(parts) as unknown as Budget)
}

/** Данные могли быть записаны прошлой версией приложения — дополняем недостающее. */
function normalize(b: Budget): Budget {
  const cal = b.calendar ?? { extraHolidays: [], extraWorkdays: [] }
  const groups: Group[] = (b.groups ?? []).map((g, i) => ({ ...g, order: g.order ?? (i + 1) * 10 }))
  // Приходы жили без своей крупной категории — из-за этого они не показывались в разборе.
  const known = new Set(groups.map((g) => g.id))
  let tail = groups.length
  for (const c of b.categories ?? []) {
    if (known.has(c.group)) continue
    known.add(c.group)
    tail += 1
    groups.push({
      id: c.group,
      name: c.group === 'income' ? 'Приходы' : c.groupName || c.group,
      order: tail * 10,
    })
  }
  const names = new Map(groups.map((g) => [g.id, g.name]))
  const categories = (b.categories ?? []).map((c) => ({ ...c, groupName: names.get(c.group) ?? c.groupName }))

  // Строка, чья подкатегория не существует, раньше просто выпадала из всех сводов:
  // трата была, а в разборе по категориям её нет. Лучше показать её в «Прочем».
  const catIds = new Set(categories.map((c) => c.id))
  const fallback = catIds.has('other-x') ? 'other-x' : categories[0]?.id
  const rehome = <T extends { categoryId: string }>(x: T) =>
    (catIds.has(x.categoryId) || !fallback ? x : { ...x, categoryId: fallback })

  return {
    ...b,
    calendar: {
      extraHolidays: cal.extraHolidays ?? [],
      extraWorkdays: cal.extraWorkdays ?? [],
      months: cal.months ?? {},
    },
    groups,
    categories,
    entries: (b.entries ?? []).map(rehome),
    templates: (b.templates ?? []).map(rehome),
    // Индексации больше нет: вперёд действует последний вбитый оклад.
    salary: { history: b.salary?.history ?? [] },
  }
}

export interface SpreadItem {
  entry: Entry
  change: 'amount' | 'add' | 'remove'
}

interface Ctx {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  budget: Budget | null
  dirty: boolean
  save: SaveState
  canEdit: boolean
  github: GithubConfig
  setGithub: (cfg: GithubConfig) => void
  /** Что отменит кнопка «Назад», null — отменять нечего. */
  undoLabel: string | null
  redoLabel: string | null
  undo: () => void
  redo: () => void
  updatePaycheck: (id: string, patch: Partial<Paycheck>) => void
  updateEntry: (id: string, patch: Partial<Entry>) => void
  addEntry: (paycheckId: string, kind: Entry['kind']) => string
  removeEntry: (id: string) => void
  /** Перетащить строку на новое место внутри её секции. */
  reorderEntry: (id: string, from: number, to: number) => void
  /** Перенести строку целиком в другую получку. */
  moveEntryToPaycheck: (id: string, targetPaycheckId: string) => void
  /** Перенести правку строки на все последующие получки того же типа. */
  spreadForward: (paycheckId: string, entry: Entry, change: 'amount' | 'add' | 'remove') => number
  /** То же самое сразу для пачки правок — одним действием и одним шагом «Назад». */
  spreadForwardMany: (paycheckId: string, items: SpreadItem[]) => number
  updateTemplate: (id: string, patch: Partial<Template>) => void
  addTemplate: (t: Template) => void
  removeTemplate: (id: string) => void
  /** Перетащить шаблон внутри его списка (регулярные одного типа / события месяца). */
  reorderTemplate: (from: number, to: number, groupIds: string[]) => void
  /** Записать шаблон и протащить правку в уже расписанные получки с указанной. */
  applyTemplateToPaychecks: (
    t: Template, fromPaycheckId: string, change: TemplateChange, prev?: Template,
  ) => number
  updateSalary: (patch: Partial<SalaryConfig>) => void
  updateCalendar: (patch: Partial<CalendarOverrides>) => void
  updateCategory: (id: string, patch: Partial<Category>) => void
  addCategory: (c: Category) => void
  /** Слить подкатегории в одну: строки и шаблоны переезжают, лишние записи исчезают. */
  mergeCategories: (fromIds: string[], intoId: string) => number
  /** Убрать подкатегорию совсем. Только пустую: за занятой стоит история. */
  removeCategory: (id: string) => void
  updateGroup: (id: string, patch: Partial<Group>) => void
  addGroup: (g: Group) => void
  extendTo: (year: number) => number
  publish: () => Promise<void>
  discardDraft: () => void
  reload: () => void
}

const BudgetContext = createContext<Ctx | null>(null)

export function BudgetProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Ctx['status']>('loading')
  const [error, setError] = useState<string | null>(null)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [dirty, setDirty] = useState(false)
  const [remoteUpdatedAt, setRemoteUpdatedAt] = useState('')
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [github, setGithubState] = useState<GithubConfig>(loadGithubConfig)
  const [nonce, setNonce] = useState(0)

  /**
   * Текущие данные держим ещё и в ref: действия должны видеть результат
   * предыдущего действия сразу, а не на следующем рендере, и возвращать,
   * сколько получек они затронули.
   */
  const current = useRef<Budget | null>(null)
  const past = useRef<Snapshot[]>([])
  const ahead = useRef<Snapshot[]>([])
  const [historyTick, setHistoryTick] = useState(0)
  const remoteRef = useRef('')
  remoteRef.current = remoteUpdatedAt

  useEffect(() => {
    let alive = true
    setStatus('loading')
    fetchBudget()
      .then((remote) => {
        if (!alive) return
        const draft = readDraft()
        // Черновик живёт, пока опубликованные данные старше него: деплой ещё не доехал.
        // Как только сервер догнал (или обогнал — например, после повторной миграции), берём сервер.
        const behind = draft && Date.parse(remote.meta.updatedAt) < Date.parse(draft.remoteUpdatedAt)
        const next = draft && behind ? normalize(draft.budget) : remote
        if (draft && behind) {
          setDirty(draft.dirty)
          setRemoteUpdatedAt(draft.remoteUpdatedAt)
        } else {
          writeDraft(null)
          setDirty(false)
          setRemoteUpdatedAt(remote.meta.updatedAt)
        }
        setBudget(next)
        current.current = next
        past.current = []
        ahead.current = []
        setHistoryTick((t) => t + 1)
        setStatus('ready')
      })
      .catch((e) => {
        if (!alive) return
        setError(String(e.message ?? e))
        setStatus('error')
      })
    return () => { alive = false }
  }, [nonce])

  /** Единственная точка записи: сюда сходятся все правки, отсюда растёт история. */
  const apply = useCallback((next: Budget, label: string) => {
    const prev = current.current
    if (prev) {
      past.current = [...past.current, { label, budget: prev }].slice(-HISTORY_LIMIT)
      ahead.current = []
    }
    current.current = next
    setBudget(next)
    writeDraft({ remoteUpdatedAt: remoteRef.current, dirty: true, budget: next })
    setDirty(true)
    setSave({ kind: 'idle' })
    setHistoryTick((t) => t + 1)
  }, [])

  const edit = useCallback((label: string, fn: (b: Budget) => Budget) => {
    const b = current.current
    if (!b) return
    apply(fn(b), label)
  }, [apply])

  const undo = useCallback(() => {
    const snap = past.current[past.current.length - 1]
    const now = current.current
    if (!snap || !now) return
    past.current = past.current.slice(0, -1)
    ahead.current = [...ahead.current, { label: snap.label, budget: now }].slice(-HISTORY_LIMIT)
    current.current = snap.budget
    setBudget(snap.budget)
    writeDraft({ remoteUpdatedAt: remoteRef.current, dirty: true, budget: snap.budget })
    setDirty(true)
    setSave({ kind: 'idle' })
    setHistoryTick((t) => t + 1)
  }, [])

  const redo = useCallback(() => {
    const snap = ahead.current[ahead.current.length - 1]
    const now = current.current
    if (!snap || !now) return
    ahead.current = ahead.current.slice(0, -1)
    past.current = [...past.current, { label: snap.label, budget: now }].slice(-HISTORY_LIMIT)
    current.current = snap.budget
    setBudget(snap.budget)
    writeDraft({ remoteUpdatedAt: remoteRef.current, dirty: true, budget: snap.budget })
    setDirty(true)
    setSave({ kind: 'idle' })
    setHistoryTick((t) => t + 1)
  }, [])

  const updatePaycheck: Ctx['updatePaycheck'] = useCallback((id, patch) => {
    edit(patch.date !== undefined ? 'правку даты получки' : 'правку зарплаты', (b) => ({
      ...b, paychecks: b.paychecks.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
  }, [edit])

  const updateEntry: Ctx['updateEntry'] = useCallback((id, patch) => {
    const what = patch.fact !== undefined ? 'правку факта'
      : patch.title !== undefined ? 'переименование строки' : 'правку суммы'
    edit(what, (b) => ({ ...b, entries: b.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
  }, [edit])

  const addEntry: Ctx['addEntry'] = useCallback((paycheckId, kind) => {
    const id = `${paycheckId}-new-${Date.now().toString(36)}`
    edit('добавление строки', (b) => {
      const siblings = b.entries.filter((e) => e.paycheckId === paycheckId)
      const order = siblings.length ? Math.max(...siblings.map((e) => e.order)) + 1 : 10
      const entry: Entry = {
        id, paycheckId, kind, order,
        categoryId: kind === 'income' ? 'inc-other' : 'other-x',
        title: '', plan: null, fact: null,
      }
      return { ...b, entries: [...b.entries, entry] }
    })
    return id
  }, [edit])

  const removeEntry: Ctx['removeEntry'] = useCallback((id) => {
    const title = current.current?.entries.find((e) => e.id === id)?.title
    edit(`удаление «${title || 'строки'}»`, (b) => ({ ...b, entries: b.entries.filter((e) => e.id !== id) }))
  }, [edit])

  const reorderEntry: Ctx['reorderEntry'] = useCallback((id, from, to) => {
    edit('перестановку строки', (b) => {
      const me = b.entries.find((e) => e.id === id)
      if (!me) return b
      // Двигаем внутри своей секции: обязательные, необязательные и приходы — разные списки.
      const group = b.entries.filter((e) => e.paycheckId === me.paycheckId && e.kind === me.kind)
      return { ...b, entries: reorderList(b.entries, group, from, to) }
    })
  }, [edit])

  const moveEntryToPaycheck: Ctx['moveEntryToPaycheck'] = useCallback((id, targetPaycheckId) => {
    edit('перенос строки в другую получку', (b) => {
      const me = b.entries.find((e) => e.id === id)
      if (!me || me.paycheckId === targetPaycheckId) return b
      const siblings = b.entries.filter((e) => e.paycheckId === targetPaycheckId)
      const order = siblings.length ? Math.max(...siblings.map((e) => e.order)) + 1 : 10
      // Строка уезжает из-под своего шаблона: в новой получке она живёт сама по себе.
      return {
        ...b,
        entries: b.entries.map((e) => (
          e.id === id ? { ...e, paycheckId: targetPaycheckId, templateId: null, order } : e
        )),
      }
    })
  }, [edit])

  const spreadForward: Ctx['spreadForward'] = useCallback((pid, entry, change) => {
    const b = current.current
    if (!b) return 0
    const res = applyForward(b, pid, entry, change)
    apply({ ...b, entries: res.entries, templates: res.templates }, 'перенос правки вперёд')
    return res.touched
  }, [apply])

  const spreadForwardMany: Ctx['spreadForwardMany'] = useCallback((pid, items) => {
    const b = current.current
    if (!b || !items.length) return 0
    let acc = b
    let touched = 0
    for (const it of items) {
      const res = applyForward(acc, pid, it.entry, it.change)
      acc = { ...acc, entries: res.entries, templates: res.templates }
      touched += res.touched
    }
    apply(acc, items.length > 1 ? 'перенос правок вперёд' : 'перенос правки вперёд')
    return touched
  }, [apply])

  const updateTemplate: Ctx['updateTemplate'] = useCallback((id, patch) => {
    edit('правку базы', (b) => ({
      ...b, templates: b.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }))
  }, [edit])

  const addTemplate: Ctx['addTemplate'] = useCallback((t) => {
    edit('добавление в базу', (b) => ({ ...b, templates: [...b.templates, t] }))
  }, [edit])

  const removeTemplate: Ctx['removeTemplate'] = useCallback((id) => {
    const title = current.current?.templates.find((t) => t.id === id)?.title
    edit(`удаление «${title || 'строки'}» из базы`, (b) => ({
      ...b, templates: b.templates.filter((t) => t.id !== id),
    }))
  }, [edit])

  const reorderTemplate: Ctx['reorderTemplate'] = useCallback((from, to, groupIds) => {
    edit('перестановку в базе', (b) => {
      const set = new Set(groupIds)
      return { ...b, templates: reorderList(b.templates, b.templates.filter((t) => set.has(t.id)), from, to) }
    })
  }, [edit])

  const applyTemplateToPaychecks: Ctx['applyTemplateToPaychecks'] =
    useCallback((t, fromPaycheckId, change, prev) => {
      const b = current.current
      if (!b) return 0
      // «Применить с этой получки» — значит шаблон действует с неё же, иначе он её не застаёт.
      const template = fromPaycheckId < t.from ? { ...t, from: fromPaycheckId } : t
      const res = applyTemplate(b, template, fromPaycheckId, change, prev)
      const templates = change === 'remove'
        ? b.templates.filter((x) => x.id !== t.id)
        : b.templates.some((x) => x.id === t.id)
          ? b.templates.map((x) => (x.id === t.id ? template : x))
          : [...b.templates, template]
      apply({ ...b, entries: res.entries, templates },
        change === 'remove' ? `удаление «${t.title || 'строки'}» из базы` : 'правку базы')
      return res.touched
    }, [apply])

  const updateSalary: Ctx['updateSalary'] = useCallback((patch) => {
    edit('правку оклада', (b) => ({ ...b, salary: { ...b.salary, ...patch } }))
  }, [edit])

  const updateCalendar: Ctx['updateCalendar'] = useCallback((patch) => {
    edit('правку рабочих дней', (b) => ({ ...b, calendar: { ...b.calendar, ...patch } }))
  }, [edit])

  const updateCategory: Ctx['updateCategory'] = useCallback((id, patch) => {
    edit('правку категории', (b) => ({
      ...b,
      categories: b.categories.map((c) => {
        if (c.id !== id) return c
        const next = { ...c, ...patch }
        // groupName лежит рядом с group ещё со времён таблицы — держим их согласованными.
        const g = b.groups.find((x) => x.id === next.group)
        return g ? { ...next, groupName: g.name } : next
      }),
    }))
  }, [edit])

  const addCategory: Ctx['addCategory'] = useCallback((c) => {
    edit('добавление категории', (b) => ({ ...b, categories: [...b.categories, c] }))
  }, [edit])

  const mergeCategories: Ctx['mergeCategories'] = useCallback((fromIds, intoId) => {
    const b = current.current
    if (!b) return 0
    const drop = new Set(fromIds.filter((id) => id !== intoId))
    if (!drop.size) return 0
    let moved = 0
    const entries = b.entries.map((e) => {
      if (!drop.has(e.categoryId)) return e
      moved++
      return { ...e, categoryId: intoId }
    })
    const templates = b.templates.map((t) => (drop.has(t.categoryId) ? { ...t, categoryId: intoId } : t))
    const categories = b.categories.filter((c) => !drop.has(c.id))
    apply({ ...b, entries, templates, categories }, 'объединение категорий')
    return moved
  }, [apply])

  const removeCategory: Ctx['removeCategory'] = useCallback((id) => {
    const name = current.current?.categories.find((c) => c.id === id)?.name
    edit(`удаление категории «${name || 'без названия'}»`, (b) => (
      // Занятую категорию не трогаем: строки остались бы без категории.
      b.entries.some((e) => e.categoryId === id) || b.templates.some((t) => t.categoryId === id)
        ? b
        : { ...b, categories: b.categories.filter((c) => c.id !== id) }
    ))
  }, [edit])

  const updateGroup: Ctx['updateGroup'] = useCallback((id, patch) => {
    edit('правку крупной категории', (b) => {
      const groups = b.groups.map((g) => (g.id === id ? { ...g, ...patch } : g))
      const name = groups.find((g) => g.id === id)?.name
      return {
        ...b,
        groups,
        categories: name
          ? b.categories.map((c) => (c.group === id ? { ...c, groupName: name } : c))
          : b.categories,
      }
    })
  }, [edit])

  const addGroup: Ctx['addGroup'] = useCallback((g) => {
    edit('добавление крупной категории', (b) => ({ ...b, groups: [...b.groups, g] }))
  }, [edit])

  const extendTo: Ctx['extendTo'] = useCallback((year) => {
    const b = current.current
    if (!b) return 0
    const gen = extendPlan(b, year, b.calendar)
    if (!gen.paychecks.length) return 0
    apply({
      ...b,
      paychecks: [...b.paychecks, ...gen.paychecks].sort((a, z) => a.date.localeCompare(z.date)),
      entries: [...b.entries, ...gen.entries],
    }, 'продление плана')
    return gen.paychecks.length
  }, [apply])

  const setGithub: Ctx['setGithub'] = useCallback((cfg) => {
    setGithubState(cfg)
    saveGithubConfig(cfg)
  }, [])

  const canEdit = import.meta.env.DEV || Boolean(github.token && github.owner && github.repo)

  const publish = useCallback(async () => {
    const b = current.current
    if (!b) return
    setSave({ kind: 'saving' })
    const updatedAt = new Date().toISOString()
    const next: Budget = { ...b, meta: { ...b.meta, updatedAt, source: 'app' } }
    const payload: Record<string, string> = {}
    for (const name of DATA_FILES) {
      payload[`${name}.json`] = JSON.stringify(next[name as keyof Budget], null, 2) + '\n'
    }
    try {
      if (import.meta.env.DEV) {
        const res = await fetch('/__save', { method: 'POST', body: JSON.stringify(payload) })
        const body = await res.json()
        if (!body.ok) throw new Error(body.error)
      } else {
        const files = Object.fromEntries(
          Object.entries(payload).map(([n, c]) => [`public/data/${n}`, c]),
        )
        await commitFiles(github, files, `бюджет: правки от ${new Date().toLocaleString('ru-RU')}`)
      }
      current.current = next
      setBudget(next)
      setRemoteUpdatedAt(updatedAt)
      setDirty(false)
      writeDraft({ remoteUpdatedAt: updatedAt, dirty: false, budget: next })
      setSave({ kind: 'published', at: updatedAt })
    } catch (e) {
      setSave({ kind: 'error', message: String((e as Error).message ?? e) })
    }
  }, [github])

  const discardDraft = useCallback(() => {
    writeDraft(null)
    past.current = []
    ahead.current = []
    setNonce((n) => n + 1)
  }, [])

  const undoLabel = past.current.length ? past.current[past.current.length - 1].label : null
  const redoLabel = ahead.current.length ? ahead.current[ahead.current.length - 1].label : null

  const value = useMemo<Ctx>(() => ({
    status, error, budget, dirty, save, canEdit, github, setGithub,
    undoLabel, redoLabel, undo, redo,
    updatePaycheck, updateEntry, addEntry, removeEntry, reorderEntry, moveEntryToPaycheck,
    publish, discardDraft, spreadForward, spreadForwardMany,
    updateTemplate, addTemplate, removeTemplate, reorderTemplate,
    applyTemplateToPaychecks, updateSalary, updateCalendar,
    updateCategory, addCategory, mergeCategories, removeCategory, updateGroup, addGroup, extendTo,
    reload: () => setNonce((n) => n + 1),
    // historyTick меняется на каждом шаге истории — без него undoLabel застревал бы.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [status, error, budget, dirty, save, canEdit, github, setGithub, historyTick,
      undoLabel, redoLabel, undo, redo,
      updatePaycheck, updateEntry, addEntry, removeEntry, reorderEntry, moveEntryToPaycheck,
      publish, discardDraft, spreadForward, spreadForwardMany,
      updateTemplate, addTemplate, removeTemplate, reorderTemplate,
      applyTemplateToPaychecks, updateSalary, updateCalendar,
      updateCategory, addCategory, mergeCategories, removeCategory, updateGroup, addGroup, extendTo])

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>
}

export function useBudget() {
  const ctx = useContext(BudgetContext)
  if (!ctx) throw new Error('useBudget вне BudgetProvider')
  return ctx
}
