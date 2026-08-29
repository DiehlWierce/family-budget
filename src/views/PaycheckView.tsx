import { useMemo } from 'react'
import { useBudget } from '../store'
import { planned, totals } from '../calc'
import { dayMonth, money, periodLabel } from '../format'
import type { Entry, Kind } from '../types'

const SECTIONS: { kind: Kind; title: string; hint: string }[] = [
  { kind: 'required', title: 'Обязательные траты', hint: 'то, что уйдёт точно' },
  { kind: 'optional', title: 'Необязательные траты', hint: 'всё, что сверху' },
  { kind: 'income', title: 'Приходы кроме зарплаты', hint: 'отпускные, возвраты, подарки' },
]

const parseAmount = (raw: string): number | null => {
  const s = raw.replace(/\s|₽/g, '').replace(',', '.')
  if (s === '') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

function AmountInput({
  value, onChange, placeholder, area, className, disabled,
}: {
  value: number | null
  onChange: (v: number | null) => void
  placeholder: string
  area: 'plan' | 'fact'
  className?: string
  disabled?: boolean
}) {
  return (
    <input
      className={`amount e-${area} ` + (className ?? '')}
      inputMode="decimal"
      disabled={disabled}
      defaultValue={value === null ? '' : String(value)}
      placeholder={placeholder}
      key={value === null ? 'empty' : String(value)}
      onBlur={(ev) => {
        const next = parseAmount(ev.target.value)
        if (next !== value) onChange(next)
      }}
      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
    />
  )
}

export function PaycheckView({
  paycheckId, onSelect,
}: {
  paycheckId: string | null
  onSelect: (id: string) => void
}) {
  const { budget, canEdit, updateEntry, updatePaycheck, addEntry, removeEntry } = useBudget()

  const data = useMemo(() => {
    if (!budget || !paycheckId) return null
    const paycheck = budget.paychecks.find((p) => p.id === paycheckId)
    if (!paycheck) return null
    const index = budget.paychecks.findIndex((p) => p.id === paycheckId)
    const rows = budget.entries
      .filter((e) => e.paycheckId === paycheckId)
      .sort((a, z) => a.order - z.order)
    return { paycheck, index, rows, t: totals(paycheck, budget.entries) }
  }, [budget, paycheckId])

  if (!budget || !data) return <div className="center">Получка не выбрана.</div>
  const { paycheck, index, rows, t } = data

  const go = (delta: number) => {
    const next = budget.paychecks[index + delta]
    if (next) onSelect(next.id)
  }

  const sectionRows = (kind: Kind) => rows.filter((e) => e.kind === kind)
  const sectionTotal = (kind: Kind) =>
    sectionRows(kind).reduce((s, e) => s + (e.fact ?? planned(e)), 0)

  return (
    <div className="page">
      <div className="picker">
        <button className="iconbtn" onClick={() => go(-1)} disabled={index === 0} aria-label="Предыдущая получка">‹</button>
        <select value={paycheck.id} onChange={(ev) => onSelect(ev.target.value)} aria-label="Выбрать получку">
          {budget.paychecks.map((p) => (
            <option key={p.id} value={p.id}>
              {dayMonth(p.date)} {p.date.slice(0, 4)} · {p.slot === 1 ? 'первая' : 'вторая'}
            </option>
          ))}
        </select>
        <button className="iconbtn" onClick={() => go(1)}
          disabled={index === budget.paychecks.length - 1} aria-label="Следующая получка">›</button>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>{dayMonth(paycheck.date)}</h2>
          <span className="hint">{periodLabel(paycheck.periodYear, paycheck.periodMonth, paycheck.slot)}</span>
        </div>
        <div className="card-body">
          <div className="erow head">
            <span>Зарплата</span><span className="r">Расчёт</span><span className="r">Пришло</span><span />
          </div>
          <div className="erow">
            <span className="e-name tiny muted">Зарплата</span>
            <AmountInput
              value={paycheck.salaryPlan} placeholder="расчёт" area="plan" disabled={!canEdit}
              onChange={(v) => updatePaycheck(paycheck.id, { salaryPlan: v ?? 0 })}
            />
            <AmountInput
              value={paycheck.salaryFact} placeholder="пришло" area="fact" className="fact" disabled={!canEdit}
              onChange={(v) => updatePaycheck(paycheck.id, { salaryFact: v })}
            />
            <span />
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            Если пришло не столько, сколько посчитал — впиши факт во второе поле.
          </div>

          <div className="pair" style={{ marginTop: 14 }}>
            <div><div className="k">Пришло всего</div><div className="v">{money(t.income)}</div></div>
            <div><div className="k">Расписано</div><div className="v">{money(t.actualOut)}</div></div>
            <div><div className="k">Осталось оплатить</div><div className="v">{money(t.toPay)}</div></div>
            <div>
              <div className="k">{t.free < 0 ? 'Не хватает' : 'Свободно'}</div>
              <div className="v" style={{ color: t.free < 0 ? 'var(--crit)' : 'var(--good)' }}>
                {money(Math.abs(t.free))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {SECTIONS.map((section) => {
        const list = sectionRows(section.kind)
        return (
          <div key={section.kind}>
            <div className="section-title">
              {section.title}
              <span className="tiny muted">{section.hint}</span>
              <span className="total">{money(sectionTotal(section.kind))}</span>
            </div>
            <div className="card"><div className="card-body" style={{ paddingTop: 8 }}>
              <div className="erow head">
                <span>Название</span><span className="r">План</span><span className="r">Факт</span><span />
              </div>
              {list.length === 0 && <div className="tiny muted" style={{ padding: '10px 8px' }}>Пусто.</div>}
              {list.map((e: Entry) => (
                <div className={'erow' + (canEdit ? '' : ' readonly')} key={e.id}>
                  <input
                    className="e-name"
                    defaultValue={e.title}
                    placeholder="на что"
                    disabled={!canEdit}
                    onBlur={(ev) => {
                      if (ev.target.value !== e.title) updateEntry(e.id, { title: ev.target.value })
                    }}
                  />
                  <AmountInput
                    value={e.plan} placeholder="план" area="plan" disabled={!canEdit}
                    onChange={(v) => updateEntry(e.id, { plan: v })}
                  />
                  <AmountInput
                    value={e.fact} placeholder="факт" area="fact" className="fact" disabled={!canEdit}
                    onChange={(v) => updateEntry(e.id, { fact: v })}
                  />
                  {canEdit ? (
                    <button className="del" title="Удалить строку" onClick={() => removeEntry(e.id)}>×</button>
                  ) : <span />}
                </div>
              ))}
              {canEdit && (
                <button className="addbtn" onClick={() => addEntry(paycheck.id, section.kind)}>
                  + добавить строку
                </button>
              )}
            </div></div>
          </div>
        )
      })}
    </div>
  )
}
