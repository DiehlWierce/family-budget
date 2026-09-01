import { useMemo, useState, type CSSProperties } from 'react'
import { useBudget } from '../store'
import { actual, byId, monthStats, planned, totals } from '../calc'
import { INCOME_GROUP } from '../components/CategoryPicker'
import { dayMonth, money, moneyShort, monthName, plural } from '../format'
import type { Entry, Kind } from '../types'

type Mode = 'months' | 'matrix' | 'rows'
type KindFilter = 'all' | Kind

const MODES: { id: Mode; label: string }[] = [
  { id: 'months', label: 'По месяцам' },
  { id: 'matrix', label: 'Свод' },
  { id: 'rows', label: 'Все строки' },
]

const KINDS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'всё' },
  { id: 'required', label: 'обязательные' },
  { id: 'optional', label: 'необязательные' },
  { id: 'income', label: 'приходы' },
]

/** За раз показываем столько получек — дальше по кнопке. */
const PAYCHECKS_STEP = 12

/**
 * Журнал — весь бюджет одним куском: месяцы рядом друг с другом, свод по
 * категориям и плоский список строк. Отсюда видно, из чего сложилась любая цифра.
 */
export function Ledger({ onOpenPaycheck }: { onOpenPaycheck: (id: string) => void }) {
  const { budget } = useBudget()
  const [mode, setMode] = useState<Mode>('months')
  const [year, setYear] = useState<number | 'all'>(new Date().getFullYear())
  const [group, setGroup] = useState<string>('all')
  const [category, setCategory] = useState<string>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAYCHECKS_STEP)
  const [openMonth, setOpenMonth] = useState<string | null>(null)

  const view = useMemo(() => {
    if (!budget) return null
    const cats = byId(budget.categories)
    const pays = byId(budget.paychecks)
    const groups = [...budget.groups].sort((a, z) => (a.order ?? 0) - (z.order ?? 0))
    const inYear = (id: string) => year === 'all' || pays[id]?.periodYear === year
    const needle = query.trim().toLowerCase()

    const filtered = budget.entries.filter((e) => {
      if (!pays[e.paycheckId] || !inYear(e.paycheckId)) return false
      if (kind !== 'all' && e.kind !== kind) return false
      const cat = cats[e.categoryId]
      if (group !== 'all' && cat?.group !== group) return false
      if (category !== 'all' && e.categoryId !== category) return false
      if (needle && !(e.title.toLowerCase().includes(needle)
        || (cat?.name ?? '').toLowerCase().includes(needle))) return false
      return true
    })

    const filtering = kind !== 'all' || group !== 'all' || category !== 'all' || needle.length > 0
    const months = monthStats(budget, year)
    const sums = new Map<string, number>()
    for (const e of filtered) {
      const p = pays[e.paycheckId]
      const key = `${p.periodYear}-${String(p.periodMonth).padStart(2, '0')}`
      sums.set(key, (sums.get(key) ?? 0) + actual(e))
    }

    // Свод: пока не выбрана крупная категория — строки по крупным, дальше по подкатегориям.
    const columns = year === 'all'
      ? [...new Set(budget.paychecks.map((p) => p.periodYear))].sort().map((y) => ({
        key: String(y), label: String(y),
      }))
      : months.map((m) => ({ key: m.key, label: monthName(m.month).slice(0, 3) }))
    const colKey = (paycheckId: string) => {
      const p = pays[paycheckId]
      return year === 'all' ? String(p.periodYear) : `${p.periodYear}-${String(p.periodMonth).padStart(2, '0')}`
    }
    const matrix = new Map<string, { id: string; name: string; cells: Map<string, number>; total: number }>()
    for (const e of filtered) {
      const cat = cats[e.categoryId]
      if (!cat) continue
      const id = group === 'all' ? cat.group : cat.id
      const name = group === 'all'
        ? (groups.find((g) => g.id === cat.group)?.name ?? cat.groupName)
        : cat.name
      const row = matrix.get(id) ?? { id, name, cells: new Map<string, number>(), total: 0 }
      const k = colKey(e.paycheckId)
      row.cells.set(k, (row.cells.get(k) ?? 0) + actual(e))
      row.total += actual(e)
      matrix.set(id, row)
    }

    const byPaycheck = new Map<string, Entry[]>()
    for (const e of [...filtered].sort((a, z) => a.order - z.order)) {
      byPaycheck.set(e.paycheckId, [...(byPaycheck.get(e.paycheckId) ?? []), e])
    }
    const groupedRows = [...byPaycheck.entries()]
      .sort((a, z) => pays[z[0]].date.localeCompare(pays[a[0]].date))
      .map(([id, list]) => ({ paycheck: pays[id], list }))

    const catsOfGroup = budget.categories
      .filter((c) => group === 'all' || c.group === group)
      .sort((a, z) => a.name.localeCompare(z.name, 'ru'))

    return {
      cats, pays, groups, months, sums, filtered, filtering, columns,
      matrix: [...matrix.values()].sort((a, z) => z.total - a.total),
      groupedRows, catsOfGroup,
      years: [...new Set(budget.paychecks.map((p) => p.periodYear))].sort(),
      planSum: filtered.reduce((s, e) => s + planned(e), 0),
      factSum: filtered.reduce((s, e) => s + (e.fact ?? 0), 0),
      totalSum: filtered.reduce((s, e) => s + actual(e), 0),
    }
  }, [budget, year, group, category, kind, query])

  if (!budget || !view) return <div className="center">Загрузка…</div>
  const {
    cats, groups, months, sums, filtered, filtering, columns, matrix, groupedRows,
    catsOfGroup, years, planSum, factSum, totalSum,
  } = view

  const maxCell = Math.max(1, ...matrix.flatMap((r) => [...r.cells.values()]))
  const reset = () => { setGroup('all'); setCategory('all'); setKind('all'); setQuery('') }

  return (
    <div className="page">
      <div className="headline">
        <div className="eyebrow">Все данные разом</div>
        <h1>Журнал</h1>
        <p>
          Что куда ушло за любой месяц и год — без перелистывания получек.
          Фильтры внизу действуют на все три вида сразу.
        </p>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="filters">
            <label className="field">
              <span>Год</span>
              <select value={String(year)}
                onChange={(ev) => setYear(ev.target.value === 'all' ? 'all' : Number(ev.target.value))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
                <option value="all">все годы</option>
              </select>
            </label>
            <label className="field">
              <span>Крупная категория</span>
              <select value={group} onChange={(ev) => { setGroup(ev.target.value); setCategory('all') }}>
                <option value="all">все</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Подкатегория</span>
              <select value={category} onChange={(ev) => setCategory(ev.target.value)}>
                <option value="all">все</option>
                {catsOfGroup.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.archived ? ' · архив' : ''}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Тип</span>
              <select value={kind} onChange={(ev) => setKind(ev.target.value as KindFilter)}>
                {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </label>
            <label className="field wide">
              <span>Поиск по названию</span>
              <input value={query} placeholder="например, психолог"
                onChange={(ev) => { setQuery(ev.target.value); setLimit(PAYCHECKS_STEP) }} />
            </label>
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            Отобрано {filtered.length} {plural(filtered.length, 'строка', 'строки', 'строк')} ·
            план {moneyShort(planSum)} · факт {moneyShort(factSum)} · в счёт идёт {money(totalSum)}
            {filtering && <> · <button className="linkbtn" onClick={reset}>сбросить фильтры</button></>}
          </div>
        </div>
      </div>

      <div className="segmented">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'months' && (
        <div className="card">
          <div className="card-head"><h2>Месяцы рядом</h2>
            <span className="hint">{filtering ? 'по фильтру' : 'целиком'}</span>
          </div>
          <div className="card-body">
            <div className="tablewrap">
              <table>
                <thead>
                  {filtering ? (
                    <tr>
                      <th>Месяц</th><th className="n">По фильтру</th>
                      <th className="n">Приход</th><th className="n">Доля</th>
                    </tr>
                  ) : (
                    <tr>
                      <th>Месяц</th><th className="n">Приход</th><th className="n">Обяз.</th>
                      <th className="n">Необяз.</th><th className="n">Свободно</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {months.map((m) => {
                    const picked = sums.get(m.key) ?? 0
                    const open = openMonth === m.key
                    return [
                      <tr key={m.key} className="clickable"
                        onClick={() => setOpenMonth(open ? null : m.key)}>
                        <td>{monthName(m.month)} {year === 'all' ? m.year : ''}</td>
                        {filtering ? (
                          <>
                            <td className="n">{moneyShort(picked)}</td>
                            <td className="n">{moneyShort(m.income)}</td>
                            <td className="n">{m.income ? Math.round((picked / m.income) * 100) : 0}%</td>
                          </>
                        ) : (
                          <>
                            <td className="n">{moneyShort(m.income)}</td>
                            <td className="n">{moneyShort(m.required)}</td>
                            <td className="n">{moneyShort(m.optional)}</td>
                            <td className={'n ' + (m.free < 0 ? 'dev-over' : 'dev-under')}>
                              {moneyShort(m.free)}
                            </td>
                          </>
                        )}
                      </tr>,
                      ...(open ? m.paychecks.map((p) => {
                        const t = totals(p, budget)
                        return (
                          <tr key={p.id} className="sub-row">
                            <td>
                              <button className="linkbtn" onClick={() => onOpenPaycheck(p.id)}>
                                {dayMonth(p.date)} · {p.slot === 1 ? 'первая' : 'вторая'}
                              </button>
                            </td>
                            {filtering ? (
                              <>
                                <td className="n">
                                  {moneyShort(filtered.filter((e) => e.paycheckId === p.id)
                                    .reduce((s, e) => s + actual(e), 0))}
                                </td>
                                <td className="n">{moneyShort(t.income)}</td>
                                <td className="n" />
                              </>
                            ) : (
                              <>
                                <td className="n">{moneyShort(t.income)}</td>
                                <td className="n">{moneyShort(t.required)}</td>
                                <td className="n">{moneyShort(t.optional)}</td>
                                <td className={'n ' + (t.free < 0 ? 'dev-over' : 'dev-under')}>
                                  {moneyShort(t.free)}
                                </td>
                              </>
                            )}
                          </tr>
                        )
                      }) : []),
                    ]
                  })}
                </tbody>
              </table>
            </div>
            <div className="tiny muted" style={{ marginTop: 10 }}>
              Нажми на месяц — раскроются обе получки. Нажми на дату — откроется сама получка.
            </div>
          </div>
        </div>
      )}

      {mode === 'matrix' && (
        <div className="card">
          <div className="card-head">
            <h2>{group === 'all' ? 'Крупные категории' : (groups.find((g) => g.id === group)?.name ?? '')}</h2>
            <span className="hint">{year === 'all' ? 'по годам' : 'по месяцам'}</span>
          </div>
          <div className="card-body">
            {matrix.length === 0 ? (
              <div className="tiny muted">Под фильтр ничего не попало.</div>
            ) : (
              <div className="tablewrap">
                <table className="matrix">
                  <thead>
                    <tr>
                      <th className="sticky">{group === 'all' ? 'Категория' : 'Подкатегория'}</th>
                      {columns.map((c) => <th key={c.key} className="n">{c.label}</th>)}
                      <th className="n">Всего</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((r) => (
                      <tr key={r.id}>
                        <td className="sticky">
                          {group === 'all' ? (
                            <button className="linkbtn" onClick={() => setGroup(r.id)}>{r.name}</button>
                          ) : r.name}
                        </td>
                        {columns.map((c) => {
                          const v = r.cells.get(c.key) ?? 0
                          return (
                            <td key={c.key} className="n heat"
                              style={{ '--heat': v ? Math.max(0.08, v / maxCell) : 0 } as CSSProperties}>
                              {v ? moneyShort(v) : ''}
                            </td>
                          )
                        })}
                        <td className="n"><b>{moneyShort(r.total)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="tiny muted" style={{ marginTop: 10 }}>
              {group === 'all'
                ? 'Нажми на крупную категорию — развернётся до подкатегорий.'
                : <>Показаны подкатегории. <button className="linkbtn" onClick={() => setGroup('all')}>
                    вернуться к крупным</button></>}
            </div>
          </div>
        </div>
      )}

      {mode === 'rows' && (
        <div className="card">
          <div className="card-head"><h2>Строки</h2>
            <span className="hint">свежие сверху</span>
          </div>
          <div className="card-body">
            {groupedRows.length === 0 && <div className="tiny muted">Под фильтр ничего не попало.</div>}
            {groupedRows.slice(0, limit).map(({ paycheck, list }) => (
              <div key={paycheck.id} style={{ marginBottom: 18 }}>
                <div className="section-title" style={{ marginTop: 0 }}>
                  <button className="linkbtn" onClick={() => onOpenPaycheck(paycheck.id)}>
                    {dayMonth(paycheck.date)} {paycheck.date.slice(0, 4)}
                  </button>
                  <span className="total">{money(list.reduce((s, e) => s + actual(e), 0))}</span>
                </div>
                <div className="rows">
                  {list.map((e) => (
                    <div className="row" key={e.id}>
                      <div>
                        <div className="name">{e.title || 'Без названия'}</div>
                        <div className="sub">
                          {cats[e.categoryId]?.name ?? 'Без категории'}
                          {' · '}
                          {e.kind === 'required' ? 'обязательная'
                            : e.kind === 'optional' ? 'необязательная' : 'приход'}
                          {cats[e.categoryId] && cats[e.categoryId].group !== INCOME_GROUP
                            ? ` · ${cats[e.categoryId].groupName}` : ''}
                        </div>
                      </div>
                      <div className="amount"
                        style={{ color: e.kind === 'income' ? 'var(--good)' : undefined }}>
                        {e.fact !== null ? money(e.fact) : money(planned(e))}
                        {e.fact === null && <span className="tiny muted"> план</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {groupedRows.length > limit && (
              <button className="btn ghost" style={{ width: '100%' }}
                onClick={() => setLimit(limit + PAYCHECKS_STEP)}>Показать ещё</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
