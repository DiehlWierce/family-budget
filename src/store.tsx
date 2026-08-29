import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Budget, Entry, GithubConfig, Paycheck } from './types'
import { commitFiles } from './github'

const DRAFT_KEY = 'fb.draft.v1'
const GH_KEY = 'fb.github.v1'
const DATA_FILES = ['meta', 'paychecks', 'entries', 'categories', 'groups'] as const

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
    updatePaycheck, updateEntry, addEntry, removeEntry, publish, discardDraft,
    reload: () => setNonce((n) => n + 1),
  }), [status, error, budget, dirty, save, canEdit, github, setGithub,
      updatePaycheck, updateEntry, addEntry, removeEntry, publish, discardDraft])

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>
}

export function useBudget() {
  const ctx = useContext(BudgetContext)
  if (!ctx) throw new Error('useBudget вне BudgetProvider')
  return ctx
}
