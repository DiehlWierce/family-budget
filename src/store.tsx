import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Budget, Entry, GithubConfig, Paycheck, SalaryConfig, Template } from './types'
import { commitFiles } from './github'
import { applyForward, applyTemplate, extendPlan, swapOrder, type TemplateChange } from './plan'

const DRAFT_KEY = 'fb.draft.v1'
const GH_KEY = 'fb.github.v1'
const DATA_FILES = ['meta', 'paychecks', 'entries', 'categories', 'groups',
  'templates', 'salary', 'calendar'] as const

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
  return Object.fromEntries(parts) as unknown as Budget
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
  updatePaycheck: (id: string, patch: Partial<Paycheck>) => void
  updateEntry: (id: string, patch: Partial<Entry>) => void
  addEntry: (paycheckId: string, kind: Entry['kind']) => string
  removeEntry: (id: string) => void
  /** Переставить строку внутри её секции получки. */
  moveEntry: (id: string, dir: -1 | 1) => void
  /** Перенести правку строки на все последующие получки того же типа. */
  spreadForward: (paycheckId: string, entry: Entry, change: 'amount' | 'add' | 'remove') => number
  updateTemplate: (id: string, patch: Partial<Template>) => void
  addTemplate: (t: Template) => void
  removeTemplate: (id: string) => void
  /** Переставить шаблон внутри его списка (регулярные одного типа / события месяца). */
  moveTemplate: (id: string, dir: -1 | 1, groupIds: string[]) => void
  /** Записать шаблон и протащить правку в уже расписанные получки с указанной. */
  applyTemplateToPaychecks: (
    t: Template, fromPaycheckId: string, change: TemplateChange, prev?: Template,
  ) => number
  updateSalary: (patch: Partial<SalaryConfig>) => void
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
        if (draft && behind) {
          setBudget(draft.budget)
          setDirty(draft.dirty)
          setRemoteUpdatedAt(draft.remoteUpdatedAt)
        } else {
          writeDraft(null)
          setBudget(remote)
          setDirty(false)
          setRemoteUpdatedAt(remote.meta.updatedAt)
        }
        setStatus('ready')
      })
      .catch((e) => {
        if (!alive) return
        setError(String(e.message ?? e))
        setStatus('error')
      })
    return () => { alive = false }
  }, [nonce])

  /**
   * Пишем состояние напрямую, а не через апдейтер: действиям планировщика нужно
   * вернуть, сколько получек они затронули, а апдейтер React вызывает отложенно.
   */
  const commit = useCallback((next: Budget) => {
    setBudget(next)
    writeDraft({ remoteUpdatedAt, dirty: true, budget: next })
    setDirty(true)
    setSave({ kind: 'idle' })
  }, [remoteUpdatedAt])

  const mutate = useCallback((fn: (b: Budget) => Budget) => {
    setBudget((prev) => {
      if (!prev) return prev
      const next = fn(prev)
      writeDraft({ remoteUpdatedAt, dirty: true, budget: next })
      return next
    })
    setDirty(true)
    setSave({ kind: 'idle' })
  }, [remoteUpdatedAt])

  const updatePaycheck: Ctx['updatePaycheck'] = useCallback((id, patch) => {
    mutate((b) => ({ ...b, paychecks: b.paychecks.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  }, [mutate])

  const updateEntry: Ctx['updateEntry'] = useCallback((id, patch) => {
    mutate((b) => ({ ...b, entries: b.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
  }, [mutate])

  const addEntry: Ctx['addEntry'] = useCallback((paycheckId, kind) => {
    const id = `${paycheckId}-new-${Date.now().toString(36)}`
    mutate((b) => {
      const siblings = b.entries.filter((e) => e.paycheckId === paycheckId)
      const order = siblings.length ? Math.max(...siblings.map((e) => e.order)) + 1 : 10
      const entry: Entry = {
        id, paycheckId, kind, order,
        categoryId: kind === 'income' ? 'inc-other' : kind === 'required' ? 'other' : 'other-x',
        title: '', plan: null, fact: null,
      }
      return { ...b, entries: [...b.entries, entry] }
    })
    return id
  }, [mutate])

  const removeEntry: Ctx['removeEntry'] = useCallback((id) => {
    mutate((b) => ({ ...b, entries: b.entries.filter((e) => e.id !== id) }))
  }, [mutate])

  const moveEntry: Ctx['moveEntry'] = useCallback((id, dir) => {
    mutate((b) => {
      const me = b.entries.find((e) => e.id === id)
      if (!me) return b
      // Двигаем внутри своей секции: обязательные, необязательные и приходы — разные списки.
      const group = b.entries.filter((e) => e.paycheckId === me.paycheckId && e.kind === me.kind)
      return { ...b, entries: swapOrder(b.entries, group, id, dir) }
    })
  }, [mutate])

  const spreadForward: Ctx['spreadForward'] = useCallback((pid, entry, change) => {
    if (!budget) return 0
    const res = applyForward(budget, pid, entry, change)
    commit({ ...budget, entries: res.entries, templates: res.templates })
    return res.touched
  }, [budget, commit])

  const updateTemplate: Ctx['updateTemplate'] = useCallback((id, patch) => {
    mutate((b) => ({ ...b, templates: b.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  }, [mutate])

  const addTemplate: Ctx['addTemplate'] = useCallback((t) => {
    mutate((b) => ({ ...b, templates: [...b.templates, t] }))
  }, [mutate])

  const removeTemplate: Ctx['removeTemplate'] = useCallback((id) => {
    mutate((b) => ({ ...b, templates: b.templates.filter((t) => t.id !== id) }))
  }, [mutate])

  const moveTemplate: Ctx['moveTemplate'] = useCallback((id, dir, groupIds) => {
    mutate((b) => {
      const set = new Set(groupIds)
      return { ...b, templates: swapOrder(b.templates, b.templates.filter((t) => set.has(t.id)), id, dir) }
    })
  }, [mutate])

  const applyTemplateToPaychecks: Ctx['applyTemplateToPaychecks'] =
    useCallback((t, fromPaycheckId, change, prev) => {
      if (!budget) return 0
      // «Применить с этой получки» — значит шаблон действует с неё же, иначе он её не застаёт.
      const template = fromPaycheckId < t.from ? { ...t, from: fromPaycheckId } : t
      const res = applyTemplate(budget, template, fromPaycheckId, change, prev)
      const templates = change === 'remove'
        ? budget.templates.filter((x) => x.id !== t.id)
        : budget.templates.some((x) => x.id === t.id)
          ? budget.templates.map((x) => (x.id === t.id ? template : x))
          : [...budget.templates, template]
      commit({ ...budget, entries: res.entries, templates })
      return res.touched
    }, [budget, commit])

  const updateSalary: Ctx['updateSalary'] = useCallback((patch) => {
    mutate((b) => ({ ...b, salary: { ...b.salary, ...patch } }))
  }, [mutate])

  const extendTo: Ctx['extendTo'] = useCallback((year) => {
    if (!budget) return 0
    const gen = extendPlan(budget, year, budget.calendar)
    if (!gen.paychecks.length) return 0
    commit({
      ...budget,
      paychecks: [...budget.paychecks, ...gen.paychecks].sort((a, z) => a.date.localeCompare(z.date)),
      entries: [...budget.entries, ...gen.entries],
    })
    return gen.paychecks.length
  }, [budget, commit])

  const setGithub: Ctx['setGithub'] = useCallback((cfg) => {
    setGithubState(cfg)
    saveGithubConfig(cfg)
  }, [])

  const canEdit = import.meta.env.DEV || Boolean(github.token && github.owner && github.repo)

  const publish = useCallback(async () => {
    if (!budget) return
    setSave({ kind: 'saving' })
    const updatedAt = new Date().toISOString()
    const next: Budget = { ...budget, meta: { ...budget.meta, updatedAt, source: 'app' } }
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
      setBudget(next)
      setRemoteUpdatedAt(updatedAt)
      setDirty(false)
      writeDraft({ remoteUpdatedAt: updatedAt, dirty: false, budget: next })
      setSave({ kind: 'published', at: updatedAt })
    } catch (e) {
      setSave({ kind: 'error', message: String((e as Error).message ?? e) })
    }
  }, [budget, github])

  const discardDraft = useCallback(() => {
    writeDraft(null)
    setNonce((n) => n + 1)
  }, [])

  const value = useMemo<Ctx>(() => ({
    status, error, budget, dirty, save, canEdit, github, setGithub,
    updatePaycheck, updateEntry, addEntry, removeEntry, moveEntry, publish, discardDraft,
    spreadForward, updateTemplate, addTemplate, removeTemplate, moveTemplate,
    applyTemplateToPaychecks, updateSalary, extendTo,
    reload: () => setNonce((n) => n + 1),
  }), [status, error, budget, dirty, save, canEdit, github, setGithub,
      updatePaycheck, updateEntry, addEntry, removeEntry, moveEntry, publish, discardDraft,
      spreadForward, updateTemplate, addTemplate, removeTemplate, moveTemplate,
      applyTemplateToPaychecks, updateSalary, extendTo])

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>
}

export function useBudget() {
  const ctx = useContext(BudgetContext)
  if (!ctx) throw new Error('useBudget вне BudgetProvider')
  return ctx
}
