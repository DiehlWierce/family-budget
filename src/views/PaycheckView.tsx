import { useMemo, useState } from 'react'
import { useBudget } from '../store'
import { planned, totals } from '../calc'
import { computeSalary, salaryPlan } from '../salary'
import { dayMonth, money, periodLabel, plural, today } from '../format'
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

type Pending = { entry: Entry; change: 'add' | 'remove' } | null

export function PaycheckView({
  paycheckId, onSelect,
}: {
  paycheckId: string | null
  onSelect: (id: string) => void
}) {
  const {
    budget, canEdit, updateEntry, updatePaycheck, addEntry, removeEntry, spreadForward,
  } = useBudget()
  const [pending, setPending] = useState<Pending>(null)
  const [spread, setSpread] = useState<string | null>(null)

  const data = useMemo(() => {
    if (!budget || !paycheckId) return null
    const paycheck = budget.paychecks.find((p) => p.id === paycheckId)
    if (!paycheck) return null
    const index = budget.paychecks.findIndex((p) => p.id === paycheckId)
    const rows = budget.entries
      .filter((e) => e.paycheckId === paycheckId)
      .sort((a, z) => a.order - z.order)
    return {
      paycheck, index, rows,
      t: totals(paycheck, budget),
      calc: computeSalary(paycheck, budget.salary, budget.calendar),
      plan: salaryPlan(paycheck, budget.salary, budget.calendar),
    }
  }, [budget, paycheckId])

  if (!budget || !data) return <div className="center">Получка не выбрана.</div>
  const { paycheck, index, rows, t, calc, plan } = data
  const isPast = paycheck.date <= today()
  const slotName = paycheck.slot === 1 ? 'первые' : 'вторые'

  const go = (delta: number) => {
    const next = budget.paychecks[index + delta]
    if (next) { onSelect(next.id); setPending(null); setSpread(null) }
  }

  const sectionRows = (kind: Kind) => rows.filter((e) => e.kind === kind)
  const sectionTotal = (kind: Kind) =>
    sectionRows(kind).reduce((s, e) => s + (e.fact ?? planned(e)), 0)

  const edited = (e: Entry, patch: Partial<Entry>) => {
    updateEntry(e.id, patch)
    if (!isPast && (patch.plan !== undefined || patch.title !== undefined)) {
      setPending({ entry: { ...e, ...patch }, change: 'add' })
      setSpread(null)
    }
  }

  const doSpread = () => {
    if (!pending) return
    const n = spreadForward(paycheck.id, pending.entry, pending.change)
    setSpread(
      n === 0
        ? 'Следующих получек этого типа пока нет. Правка попадёт в них, когда продлишь план.'
        : `Готово: ${n} ${plural(n, 'получка', 'получки', 'получек')} впереди обновлены.`,
    )
    setPending(null)
  }

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
          <div className="calcline">
            <div className="k">Расчёт по окладу</div>
            <div className="v num">{money(calc.amount)}</div>
            <div className="tiny muted">
              Оклад {money(calc.monthly)} · за {calc.periodLabel} · {calc.workdays} из {calc.normWorkdays}{' '}
              {plural(calc.normWorkdays, 'рабочего дня', 'рабочих дней', 'рабочих дней')}
            </div>
          </div>

          <div className="erow head">
            <span>Зарплата</span><span className="r">Вместо расчёта</span><span className="r">Пришло</span><span />
          </div>
          <div className="erow">
            <span className="e-name tiny muted">Зарплата</span>
            <AmountInput
              value={paycheck.salaryOverride} placeholder="по расчёту" area="plan" disabled={!canEdit}
              onChange={(v) => updatePaycheck(paycheck.id, { salaryOverride: v })}
            />
            <AmountInput
              value={paycheck.salaryFact} placeholder="пришло" area="fact" className="fact" disabled={!canEdit}
              onChange={(v) => updatePaycheck(paycheck.id, { salaryFact: v })}
            />
            <span />
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            {paycheck.salaryOverride !== null
              ? `Сумма вбита руками, расчёт не применяется. Очисти поле — вернётся ${money(calc.amount)}.`
              : 'Знаешь, что придёт другая сумма — впиши в среднее поле. Правое — сколько пришло на самом деле.'}
          </div>

          <div className="pair" style={{ marginTop: 14 }}>
            <div><div className="k">План получки</div><div className="v">{money(plan)}</div></div>
            <div><div className="k">Пришло всего</div><div className="v">{money(t.income)}</div></div>
            <div><div className="k">Расписано</div><div className="v">{money(t.actualOut)}</div></div>
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
                      if (ev.target.value !== e.title) edited(e, { title: ev.target.value })
                    }}
                  />
                  <AmountInput
                    value={e.plan} placeholder="план" area="plan" disabled={!canEdit}
                    onChange={(v) => edited(e, { plan: v })}
                  />
                  <AmountInput
                    value={e.fact} placeholder="факт" area="fact" className="fact" disabled={!canEdit}
                    onChange={(v) => updateEntry(e.id, { fact: v })}
                  />
                  {canEdit ? (
                    <button className="del" title="Удалить строку" onClick={() => {
                      removeEntry(e.id)
                      if (!isPast) { setPending({ entry: e, change: 'remove' }); setSpread(null) }
                    }}>×</button>
                  ) : <span />}
                </div>
              ))}
              {canEdit && (
                <button className="addbtn" onClick={() => addEntry(paycheck.id, section.kind)}>
                  {section.kind === 'income' ? '+ добавить приход' : '+ добавить строку'}
                </button>
              )}
            </div></div>
          </div>
        )
      })}

      {spread && <div className="banner" style={{ marginTop: 16 }}>{spread}</div>}

      {pending && (
        <div className="askbar">
          <div className="askbar-inner">
            <div className="tiny">
              {pending.change === 'remove'
                ? `Убрать «${pending.entry.title || 'строку'}» и из следующих ${slotName} получек?`
                : `Перенести «${pending.entry.title || 'строку'}» на все следующие ${slotName} получки?`}
            </div>
            <div className="askbar-actions">
              <button className="btn ghost" onClick={() => setPending(null)}>Только эта</button>
              <button className="btn" onClick={doSpread}>
                {pending.change === 'remove' ? 'Убрать везде' : 'И дальше'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
