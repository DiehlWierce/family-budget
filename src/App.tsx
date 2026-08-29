import { useEffect, useState } from 'react'
import { BudgetProvider, useBudget } from './store'
import { currentPaycheckId } from './calc'
import { Now } from './views/Now'
import { PaycheckView } from './views/PaycheckView'
import { Analytics } from './views/Analytics'
import { Settings } from './views/Settings'

type Tab = 'now' | 'paycheck' | 'analytics' | 'settings'

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'now', label: 'Сейчас', glyph: '◉' },
  { id: 'paycheck', label: 'Получка', glyph: '▤' },
  { id: 'analytics', label: 'Аналитика', glyph: '◨' },
  { id: 'settings', label: 'Настройки', glyph: '⚙' },
]

function SaveBar() {
  const { dirty, save, publish, canEdit } = useBudget()

  if (save.kind === 'saving') return <span className="pill dirty">публикую…</span>
  if (save.kind === 'error') {
    return (
      <>
        <span className="pill err">ошибка</span>
        <button className="btn" onClick={publish}>Ещё раз</button>
      </>
    )
  }
  if (dirty) {
    return (
      <>
        <span className="pill dirty">есть правки</span>
        <button className="btn" onClick={publish} disabled={!canEdit}>Опубликовать</button>
      </>
    )
  }
  if (save.kind === 'published') return <span className="pill ok">опубликовано</span>
  if (!canEdit) return <span className="pill view">просмотр</span>
  return null
}

function Shell() {
  const { status, error, budget, save, reload } = useBudget()
  const [tab, setTab] = useState<Tab>('now')
  const [paycheckId, setPaycheckId] = useState<string | null>(null)

  useEffect(() => {
    if (budget && !paycheckId) setPaycheckId(currentPaycheckId(budget.paychecks))
  }, [budget, paycheckId])

  const openPaycheck = (id: string) => {
    setPaycheckId(id)
    setTab('paycheck')
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-inner">
          <span className="brand">Бюджет</span>
          <span className="spacer" />
          <SaveBar />
        </div>
      </div>

      {status === 'loading' && <div className="center">Загружаю данные…</div>}

      {status === 'error' && (
        <div className="page">
          <div className="banner err">
            Не удалось загрузить данные.<pre>{error}</pre>
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={reload}>Попробовать снова</button>
        </div>
      )}

      {status === 'ready' && (
        <>
          {save.kind === 'published' && (
            <div className="page" style={{ paddingBottom: 0 }}>
              <div className="banner">
                Изменения ушли в репозиторий. Сайт пересоберётся за минуту-две — до этого ты видишь свою свежую
                версию, а жена ещё старую.
              </div>
            </div>
          )}
          {tab === 'now' && <Now onOpenPaycheck={openPaycheck} />}
          {tab === 'paycheck' && <PaycheckView paycheckId={paycheckId} onSelect={setPaycheckId} />}
          {tab === 'analytics' && <Analytics />}
          {tab === 'settings' && <Settings />}
        </>
      )}

      <nav className="nav">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            <span className="glyph" aria-hidden="true">{t.glyph}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <BudgetProvider>
      <Shell />
    </BudgetProvider>
  )
}
