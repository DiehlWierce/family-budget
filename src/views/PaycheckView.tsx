import { useEffect, useMemo, useState } from 'react'
import { useBudget, type SpreadItem } from '../store'
import { currentPaycheckId, planned, totals } from '../calc'
import { computeSalary, salaryPlan } from '../salary'
import { dayMonth, money, periodLabel, plural, today } from '../format'
import { CategoryPicker } from '../components/CategoryPicker'
import { Sortable } from '../components/Sortable'
import type { Entry, Kind, Paycheck } from '../types'

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

/** Копится всё, что правилось в этой получке, — вопрос «и дальше?» задаётся по каждой правке. */
type Pending = { entry: Entry; change: 'add' | 'remove' }

export function PaycheckView({
  paycheckId, onSelect,
}: {
  paycheckId: string | null
  onSelect: (id: string) => void
}) {
  const {
    budget, canEdit, updateEntry, updatePaycheck, addEntry, removeEntry, reorderEntry,
    moveEntryToPaycheck, spreadForwardMany,
  } = useBudget()
  const [pending, setPending] = useState<Pending[]>([])
  const [detailed, setDetailed] = useState(false)
  const [spread, setSpread] = useState<string | null>(null)
  const [openRow, setOpenRow] = useState<string | null>(null)

  // Переехали на другую получку — вопросы про предыдущую больше не наши.
  useEffect(() => { setPending([]); setSpread(null); setOpenRow(null); setDetailed(false) }, [paycheckId])

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
  const nowId = currentPaycheckId(budget.paychecks)
  const isPast = paycheck.date <= today()
  const slotName = paycheck.slot === 1 ? 'первые' : 'вторые'
  const prev: Paycheck | undefined = budget.paychecks[index - 1]
  const next: Paycheck | undefined = budget.paychecks[index + 1]

  const go = (delta: number) => {
    const to = budget.paychecks[index + delta]
    if (to) onSelect(to.id)
  }

  const sectionRows = (kind: Kind) => rows.filter((e) => e.kind === kind)
  const sectionTotal = (kind: Kind) =>
    sectionRows(kind).reduce((s, e) => s + (e.fact ?? planned(e)), 0)

  /** Правка копится в очереди: одна строка — один вопрос, последняя правка побеждает. */
  const remember = (entry: Entry, change: 'add' | 'remove') => {
    if (isPast) return
    setSpread(null)
    setPending((list) => {
      const rest = list.filter((x) => x.entry.id !== entry.id)
      return [...rest, { entry, change }]
    })
  }

  const edited = (e: Entry, patch: Partial<Entry>) => {
    updateEntry(e.id, patch)
    if (patch.plan !== undefined || patch.title !== undefined) remember({ ...e, ...patch }, 'add')
  }

  const forget = (id: string) => setPending((list) => list.filter((x) => x.entry.id !== id))

  const doSpread = (items: Pending[]) => {
    if (!items.length) return
    const n = spreadForwardMany(paycheck.id, items as SpreadItem[])
    setSpread(
      n === 0
        ? 'Следующих получек этого типа пока нет. Правка попадёт в них, когда продлишь план.'
        : `Готово: ${n} ${plural(n, 'строка', 'строки', 'строк')} в получках впереди обновлены.`,
    )
    setPending((list) => list.filter((x) => !items.some((i) => i.entry.id === x.entry.id)))
  }

  const moveTo = (e: Entry, target: Paycheck) => {
    moveEntryToPaycheck(e.id, target.id)
    forget(e.id)
    setOpenRow(null)
    setSpread(`«${e.title || 'Строка'}» уехала в получку ${dayMonth(target.date)}.`)
  }

  return (
    <div className="page">
      <div className="picker">
        <button className="iconbtn" onClick={() => go(-1)} disabled={index === 0} aria-label="Предыдущая получка">‹</button>
        <select value={paycheck.id} onChange={(ev) => onSelect(ev.target.value)} aria-label="Выбрать получку">
          {budget.paychecks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === nowId ? '➤ ' : ''}{dayMonth(p.date)} {p.date.slice(0, 4)} ·{' '}
              {p.slot === 1 ? 'первая' : 'вторая'}{p.id === nowId ? ' · сейчас' : ''}
            </option>
          ))}
        </select>
        <button className="iconbtn" onClick={() => go(1)}
          disabled={index === budget.paychecks.length - 1} aria-label="Следующая получка">›</button>
        <button
          className="btn ghost nowbtn" onClick={() => nowId && onSelect(nowId)}
          disabled={!nowId || paycheck.id === nowId} title="Вернуться к текущей получке"
        >Сейчас</button>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>{dayMonth(paycheck.date)}</h2>
          {paycheck.id === nowId && <span className="pill now">сейчас</span>}
          <span className="hint">{periodLabel(paycheck.periodYear, paycheck.periodMonth, paycheck.slot)}</span>
        </div>
        <div className="card-body">
          <div className="calcline">
            <div className="k">Расчёт по окладу</div>
            <div className="v num">{money(calc.amount)}</div>
            <div className="tiny muted">
              Оклад {money(calc.monthly)} · за {calc.periodLabel} · {calc.workdays} из {calc.normWorkdays}{' '}
              {plural(calc.normWorkdays, 'рабочего дня', 'рабочих дней', 'рабочих дней')}
              {calc.manual ? ' · дни из настроек' : ' · дни по календарю'}
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
              <div className="erow movable head">
                <span>Название</span><span className="r">План</span><span className="r">Факт</span>
                <span /><span />
              </div>
              {list.length === 0 && <div className="tiny muted" style={{ padding: '10px 8px' }}>Пусто.</div>}

              <Sortable
                items={list}
                getId={(e) => e.id}
                disabled={!canEdit}
                onReorder={(from, to) => reorderEntry(list[from].id, from, to)}
              >
                {(e, _i, handle, dragging) => (
                  <>
                    <div className={'erow movable' + (canEdit ? '' : ' readonly') + (dragging ? ' grabbed' : '')}>
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
                      {canEdit ? <button {...handle} type="button">⠿</button> : <span />}
                      {canEdit ? (
                        <button
                          className="rowmenu" title="Что сделать со строкой"
                          aria-label="Меню строки"
                          onClick={() => setOpenRow(openRow === e.id ? null : e.id)}
                        >⋯</button>
                      ) : <span />}
                    </div>
                    {openRow === e.id && canEdit && (
                      <div className="rowpanel">
                        <label className="field" style={{ marginBottom: 10 }}>
                          <span>Категория</span>
                          <CategoryPicker
                            value={e.categoryId}
                            income={e.kind === 'income'}
                            onChange={(id) => updateEntry(e.id, { categoryId: id })}
                          />
                        </label>
                        <div className="tiny muted">Перенести в другую получку</div>
                        <div className="rowpanel-actions">
                          <button className="btn ghost" disabled={!prev} onClick={() => prev && moveTo(e, prev)}>
                            ‹ {prev ? dayMonth(prev.date) : '—'}
                          </button>
                          <button className="btn ghost" disabled={!next} onClick={() => next && moveTo(e, next)}>
                            {next ? dayMonth(next.date) : '—'} ›
                          </button>
                        </div>
                        <button
                          className="btn ghost danger" style={{ marginTop: 10 }}
                          onClick={() => {
                            removeEntry(e.id)
                            setOpenRow(null)
                            remember(e, 'remove')
                          }}
                        >Удалить строку</button>
                      </div>
                    )}
                  </>
                )}
              </Sortable>

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

      {pending.length > 0 && (
        <div className="askbar">
          <div className="askbar-inner">
            {pending.length === 1 ? (
              <div className="tiny">
                {pending[0].change === 'remove'
                  ? `Убрать «${pending[0].entry.title || 'строку'}» и из следующих ${slotName} получек?`
                  : `Перенести «${pending[0].entry.title || 'строку'}» на все следующие ${slotName} получки?`}
                <div className="muted">Не ответишь — останется только здесь.</div>
              </div>
            ) : (
              <div className="tiny">
                Правок в этой получке: {pending.length}.{' '}
                <button className="linkbtn" onClick={() => setDetailed(!detailed)}>
                  {detailed ? 'свернуть' : 'разобрать по одной'}
                </button>
                <div className="muted">Не ответишь — все останутся только здесь.</div>
              </div>
            )}
            <div className="askbar-actions">
              <button className="btn ghost" onClick={() => { setPending([]); setDetailed(false) }}>
                Только здесь
              </button>
              <button className="btn" onClick={() => doSpread(pending)}>
                {pending.length === 1 && pending[0].change === 'remove' ? 'Убрать везде' : 'И дальше'}
              </button>
            </div>
            {detailed && pending.length > 1 && (
              <div className="asklist">
                {pending.map((p) => (
                  <div className="askitem" key={p.entry.id}>
                    <span className="tiny">
                      {p.change === 'remove' ? 'убрать ' : ''}«{p.entry.title || 'строка'}»
                      {p.change === 'add' && p.entry.plan !== null ? ` · ${money(p.entry.plan)}` : ''}
                    </span>
                    <button className="btn ghost" onClick={() => forget(p.entry.id)}>только здесь</button>
                    <button className="btn" onClick={() => doSpread([p])}>и дальше</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
