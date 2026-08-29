import { useMemo, useState } from 'react'
import { useBudget } from '../store'
import { computeSalary, monthlyAt } from '../salary'
import { dayMonth, money, monthName, plural, today } from '../format'
import type { Template } from '../types'

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const parseAmount = (raw: string): number => {
  const s = raw.replace(/\s|₽/g, '').replace(',', '.')
  const v = Number(s)
  return Number.isFinite(v) ? v : 0
}

function AmountCell({ value, onChange, disabled }: {
  value: number; onChange: (v: number) => void; disabled?: boolean
}) {
  return (
    <input
      className="amount e-plan" inputMode="decimal" disabled={disabled}
      key={String(value)} defaultValue={String(value)}
      onBlur={(ev) => { const v = parseAmount(ev.target.value); if (v !== value) onChange(v) }}
      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
    />
  )
}

export function Plan() {
  const { budget, canEdit, updateTemplate, addTemplate, removeTemplate, updateSalary, extendTo } = useBudget()
  const [horizon, setHorizon] = useState(2030)
  const [note, setNote] = useState<string | null>(null)

  const view = useMemo(() => {
    if (!budget) return null
    const last = budget.paychecks[budget.paychecks.length - 1]
    const future = budget.paychecks.filter((p) => p.date > today()).slice(0, 8)
    const regular = budget.templates.filter((t) => t.freq === 'each')
    const yearly = budget.templates.filter((t) => t.freq === 'yearly')
    const titles: string[] = []
    for (const t of regular) if (!titles.includes(t.title)) titles.push(t.title)
    const perMonth = regular.reduce((s, t) => s + t.amount, 0)
    return { last, future, regular, yearly, titles, perMonth }
  }, [budget])

  if (!budget || !view) return <div className="center">Загрузка…</div>
  const { last, future, regular, yearly, titles, perMonth } = view
  const step = budget.salary.history[budget.salary.history.length - 1]
  const ix = budget.salary.indexation

  const find = (title: string, slot: 1 | 2) =>
    regular.find((t) => t.title === title && t.slot === slot)

  const setRegular = (title: string, slot: 1 | 2, amount: number) => {
    const existing = find(title, slot)
    if (existing) { updateTemplate(existing.id, { amount }); return }
    const sample = regular.find((t) => t.title === title)
    if (!sample) return
    addTemplate({ ...sample, id: `tpl-${slot}-${Date.now().toString(36)}`, slot, amount })
  }

  const doExtend = () => {
    const n = extendTo(horizon)
    setNote(n === 0
      ? `План уже расписан до ${horizon} года.`
      : `Добавлено ${n} ${plural(n, 'получка', 'получки', 'получек')} — план идёт до конца ${horizon} года.`)
  }

  return (
    <div className="page">
      <div className="headline">
        <div className="eyebrow">База, которая повторяется всегда</div>
        <h1>План вперёд</h1>
        <p>
          Сейчас расписано по {last ? `${dayMonth(last.date)} ${last.date.slice(0, 4)}` : '—'}.
          Новые получки создаются из этой базы, зарплата считается из оклада и рабочих дней.
        </p>
      </div>

      <div className="card">
        <div className="card-head"><h2>Горизонт</h2></div>
        <div className="card-body">
          <div className="picker">
            <select value={horizon} onChange={(ev) => setHorizon(Number(ev.target.value))}>
              {[2027, 2028, 2029, 2030, 2031, 2032].map((y) => (
                <option key={y} value={y}>до конца {y} года</option>
              ))}
            </select>
            <button className="btn" onClick={doExtend} disabled={!canEdit}>Продлить</button>
          </div>
          {note && <div className="banner" style={{ marginTop: 12 }}>{note}</div>}
          <div className="tiny muted" style={{ marginTop: 12 }}>
            Продление создаёт только недостающие получки. Уже расписанные не трогает —
            ни одна твоя правка не потеряется.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Оклад</h2>
          <span className="hint">{money(step?.monthly ?? 0)}</span>
        </div>
        <div className="card-body">
          <div className="erow head">
            <span>Действует с</span><span className="r">Оклад</span><span className="r" /><span />
          </div>
          {budget.salary.history.map((s, i) => (
            <div className="erow" key={s.from + i}>
              <input
                className="e-name" type="date" defaultValue={s.from} disabled={!canEdit}
                onBlur={(ev) => {
                  const history = budget.salary.history.map((x, j) =>
                    (j === i ? { ...x, from: ev.target.value } : x))
                  updateSalary({ history })
                }}
              />
              <AmountCell
                value={s.monthly} disabled={!canEdit}
                onChange={(v) => updateSalary({
                  history: budget.salary.history.map((x, j) => (j === i ? { ...x, monthly: v } : x)),
                })}
              />
              <span />
              {canEdit && budget.salary.history.length > 1 ? (
                <button className="del" title="Убрать" onClick={() => updateSalary({
                  history: budget.salary.history.filter((_, j) => j !== i),
                })}>×</button>
              ) : <span />}
            </div>
          ))}
          {canEdit && (
            <button className="addbtn" onClick={() => updateSalary({
              history: [...budget.salary.history, {
                from: today().slice(0, 8) + '01',
                monthly: step?.monthly ?? 0,
                note: 'повышение',
              }],
            })}>+ добавить изменение оклада</button>
          )}

          <div className="section-title" style={{ marginTop: 20 }}>Индексация</div>
          <label className="checkline">
            <input
              type="checkbox" checked={ix.enabled} disabled={!canEdit}
              onChange={(ev) => updateSalary({ indexation: { ...ix, enabled: ev.target.checked } })}
            />
            <span>Поднимать оклад каждый год</span>
          </label>
          <div className="erow" style={{ marginTop: 8 }}>
            <span className="e-name tiny muted">С какого месяца и на сколько</span>
            <select
              className="e-plan" value={ix.month} disabled={!canEdit}
              onChange={(ev) => updateSalary({ indexation: { ...ix, month: Number(ev.target.value) } })}
            >
              {MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
            <AmountCell
              value={ix.percent} disabled={!canEdit}
              onChange={(v) => updateSalary({ indexation: { ...ix, percent: v } })}
            />
            <span />
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            Индексация применяется к периодам, начинающимся с первого числа{' '}
            {monthName(ix.month).toLowerCase()}. Получка 21-го числа — первая, которая её застаёт.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Ближайшие получки</h2>
          <span className="hint">по расчёту</span>
        </div>
        <div className="card-body">
          <div className="rows">
            {future.map((p) => {
              const c = computeSalary(p, budget.salary, budget.calendar)
              return (
                <div className="row" key={p.id}>
                  <div>
                    <div className="name">{dayMonth(p.date)} {p.date.slice(0, 4)}</div>
                    <div className="sub">
                      {c.workdays} из {c.normWorkdays} раб. дней · оклад {money(c.monthly)}
                      {p.salaryOverride !== null ? ' · вбито руками' : ''}
                    </div>
                  </div>
                  <div className="amount">{money(p.salaryOverride ?? c.amount)}</div>
                </div>
              )
            })}
          </div>
          <div className="tiny muted" style={{ marginTop: 12 }}>
            Оклад через год — {money(monthlyAt(`${new Date().getFullYear() + 1}-12-01`, budget.salary))},
            через три — {money(monthlyAt(`${new Date().getFullYear() + 3}-12-01`, budget.salary))}.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Регулярные траты</h2>
          <span className="hint">{money(perMonth)} в месяц</span>
        </div>
        <div className="card-body">
          <div className="erow head">
            <span>Трата</span><span className="r">1-я получка</span><span className="r">2-я получка</span><span />
          </div>
          {titles.map((title) => (
            <div className="erow" key={title}>
              <input
                className="e-name" defaultValue={title} disabled={!canEdit}
                onBlur={(ev) => {
                  if (ev.target.value === title) return
                  for (const t of regular.filter((x) => x.title === title)) {
                    updateTemplate(t.id, { title: ev.target.value })
                  }
                }}
              />
              <AmountCell
                value={find(title, 1)?.amount ?? 0} disabled={!canEdit}
                onChange={(v) => setRegular(title, 1, v)}
              />
              <AmountCell
                value={find(title, 2)?.amount ?? 0} disabled={!canEdit}
                onChange={(v) => setRegular(title, 2, v)}
              />
              {canEdit ? (
                <button className="del" title="Убрать из базы" onClick={() => {
                  for (const t of regular.filter((x) => x.title === title)) removeTemplate(t.id)
                }}>×</button>
              ) : <span />}
            </div>
          ))}
          {canEdit && (
            <button className="addbtn" onClick={() => addTemplate({
              id: `tpl-${Date.now().toString(36)}`,
              title: '', categoryId: 'other', kind: 'required', amount: 0,
              slot: 2, freq: 'each', from: last?.id ?? '2027-03-1', to: null,
              order: 50 + regular.length,
            })}>+ добавить регулярную трату</button>
          )}
          <div className="tiny muted" style={{ marginTop: 12 }}>
            Это база для получек, которых ещё нет. Уже расписанные получки правятся на своём экране —
            там же можно перенести правку на все следующие.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Ежегодные события</h2>
          <span className="hint">{yearly.length} шт.</span>
        </div>
        <div className="card-body">
          <div className="tiny muted" style={{ marginBottom: 10 }}>
            Собрано из твоей истории: то, что повторялось в одном и том же месяце минимум дважды.
          </div>
          {MONTHS.filter((m) => yearly.some((t) => t.month === m)).map((m) => (
            <div key={m}>
              <div className="section-title" style={{ marginTop: 14 }}>{monthName(m)}</div>
              {yearly.filter((t) => t.month === m).map((t: Template) => (
                <div className="erow" key={t.id}>
                  <input
                    className="e-name" defaultValue={t.title} disabled={!canEdit}
                    onBlur={(ev) => updateTemplate(t.id, { title: ev.target.value })}
                  />
                  <AmountCell
                    value={t.amount} disabled={!canEdit}
                    onChange={(v) => updateTemplate(t.id, { amount: v })}
                  />
                  <select
                    className="e-fact" value={t.slot === 'both' ? 2 : t.slot} disabled={!canEdit}
                    onChange={(ev) => updateTemplate(t.id, { slot: Number(ev.target.value) as 1 | 2 })}
                  >
                    <option value={1}>1-я</option>
                    <option value={2}>2-я</option>
                  </select>
                  {canEdit ? (
                    <button className="del" title="Убрать" onClick={() => removeTemplate(t.id)}>×</button>
                  ) : <span />}
                </div>
              ))}
            </div>
          ))}
          {canEdit && (
            <button className="addbtn" style={{ marginTop: 14 }} onClick={() => addTemplate({
              id: `tpl-y-${Date.now().toString(36)}`,
              title: '', categoryId: 'gifts-x', kind: 'optional', amount: 0,
              slot: 2, freq: 'yearly', month: new Date().getMonth() + 1,
              from: last?.id ?? '2027-03-1', to: null, order: 200,
            })}>+ добавить ежегодное событие</button>
          )}
        </div>
      </div>
    </div>
  )
}
