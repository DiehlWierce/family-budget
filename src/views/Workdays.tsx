import { useMemo, useState } from 'react'
import { useBudget } from '../store'
import { accrualPeriod, computeSalary } from '../salary'
import { money, monthName, monthNameGen, plural, today } from '../format'
import {
  daysInMonth, halfWorkdaysByCalendar, monthKey, payDate, workdaysInMonth, type MonthWorkdays,
} from '../workdays'
import type { Paycheck } from '../types'

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const parseDays = (raw: string): number | null => {
  const s = raw.trim()
  if (s === '') return null
  const v = Number(s.replace(',', '.'))
  return Number.isFinite(v) && v >= 0 && v <= 31 ? Math.round(v) : null
}

function DaysInput({ value, hint, disabled, onChange }: {
  value: number | null
  hint: number
  disabled?: boolean
  onChange: (v: number | null) => void
}) {
  return (
    <input
      className={'amount days' + (value === null ? ' auto' : '')}
      inputMode="numeric" disabled={disabled}
      key={value === null ? 'auto' : String(value)}
      defaultValue={value === null ? '' : String(value)}
      placeholder={String(hint)}
      onBlur={(ev) => {
        const next = parseDays(ev.target.value)
        if (next !== value) onChange(next)
      }}
      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
    />
  )
}

/** Одна половина месяца: сколько отработано и когда за неё платят. */
function Half({ label, days, hint, pay, payHint, amount, canEdit, onDays, onDate }: {
  label: string
  days: number | null
  hint: number
  pay: Paycheck | null
  payHint: string
  amount: number | null
  canEdit: boolean
  onDays: (v: number | null) => void
  onDate: (v: string) => void
}) {
  return (
    <div className="wdhalf">
      <span className="wd-half-label">{label}</span>
      <DaysInput value={days} hint={hint} disabled={!canEdit} onChange={onDays} />
      <input
        className="wd-date" type="date" disabled={!canEdit || !pay}
        key={(pay?.id ?? 'none') + (pay?.date ?? '')} defaultValue={pay?.date ?? payHint}
        onBlur={(ev) => { if (pay && ev.target.value && ev.target.value !== pay.date) onDate(ev.target.value) }}
      />
      <span className="wd-half-sum tiny muted">
        {!pay ? 'получки ещё нет'
          : pay.salaryOverride !== null ? `${money(pay.salaryOverride)} · вбито руками`
            : money(amount ?? 0)}
      </span>
    </div>
  )
}

/**
 * Рабочие дни. Строка — месяц, за который начисляют, а не месяц, в который платят:
 * дни 1–15 уезжают в получку 21-го этого месяца, дни 16–конец — в получку 6-го следующего.
 * Поэтому первая получка любого месяца — это всегда вторая половина месяца прошлого.
 *
 * Начинаем с месяца, за который считается ближайшая неполученная получка. Раньше не
 * показываем: те деньги уже пришли, и правка дней их не изменит.
 */
export function Workdays() {
  const { budget, canEdit, updateCalendar, updatePaycheck } = useBudget()
  const now = today()
  // Стартовый месяц — тот, за который считается ближайшая получка: в начале января
  // это ещё декабрь прошлого года, поэтому год по умолчанию берём отсюда, а не с календаря.
  const start = useMemo(() => {
    const ahead = budget?.paychecks.find((p) => p.date >= now)
    return ahead
      ? accrualPeriod(ahead)
      : { year: Number(now.slice(0, 4)), month: Number(now.slice(5, 7)) }
  }, [budget, now])
  const [picked, setPicked] = useState<number | null>(null)
  const year = picked ?? start.year

  const view = useMemo(() => {
    if (!budget) return null
    const years = [...new Set(budget.paychecks.map((p) => p.periodYear))]
      .filter((y) => y >= start.year)
      .sort()
    const fromMonth = year === start.year ? start.month : 1
    const rows = MONTHS.filter((m) => m >= fromMonth).map((m) => {
      const nextMonth = m === 12 ? 1 : m + 1
      const nextYear = m === 12 ? year + 1 : year
      // Получка 21-го — за первую половину этого месяца, получка 6-го следующего — за вторую.
      const pay21 = budget.paychecks.find(
        (p) => p.periodYear === year && p.periodMonth === m && p.slot === 2,
      ) ?? null
      const pay6 = budget.paychecks.find(
        (p) => p.periodYear === nextYear && p.periodMonth === nextMonth && p.slot === 1,
      ) ?? null
      return {
        month: m, key: monthKey(year, m), nextMonth, nextYear, pay21, pay6,
        manual: (budget.calendar.months?.[monthKey(year, m)] ?? {}) as MonthWorkdays,
        calc: {
          norm: workdaysInMonth(year, m, budget.calendar),
          first: halfWorkdaysByCalendar(year, m, 'first', budget.calendar),
          second: halfWorkdaysByCalendar(year, m, 'second', budget.calendar),
        },
        hint21: payDate(year, m, 21, budget.calendar),
        hint6: payDate(nextYear, nextMonth, 6, budget.calendar),
        sum21: pay21 ? computeSalary(pay21, budget.salary, budget.calendar).amount : null,
        sum6: pay6 ? computeSalary(pay6, budget.salary, budget.calendar).amount : null,
      }
    })
    return { years: years.length ? years : [start.year], rows }
  }, [budget, year, start])

  if (!budget || !view) return null
  const { years, rows } = view

  const set = (key: string, field: keyof MonthWorkdays, value: number | null) => {
    const months = { ...(budget.calendar.months ?? {}) }
    const row = { ...(months[key] ?? {}) }
    if (value === null) delete row[field]
    else row[field] = value
    if (Object.keys(row).length) months[key] = row
    else delete months[key]
    updateCalendar({ months })
  }

  const filled = Object.keys(budget.calendar.months ?? {}).length

  return (
    <>
      <div className="card">
        <div className="card-head"><h2>Рабочие дни и даты получек</h2>
          <span className="hint">
            {filled ? `${filled} ${plural(filled, 'месяц', 'месяца', 'месяцев')} вбито` : 'по календарю'}
          </span>
        </div>
        <div className="card-body">
          <div className="picker">
            <select value={year} onChange={(ev) => setPicked(Number(ev.target.value))} aria-label="Год">
              {years.map((y) => <option key={y} value={y}>{y} год</option>)}
            </select>
          </div>

          {rows.map((r) => (
            <div className="wdmonth" key={r.key}>
              <div className="wdmonth-head">
                <span className="wd-name">{monthName(r.month)} {year}</span>
                <span className="wd-norm-label tiny muted">рабочих дней в месяце</span>
                <DaysInput
                  value={r.manual.norm ?? null} hint={r.calc.norm} disabled={!canEdit}
                  onChange={(v) => set(r.key, 'norm', v)}
                />
              </div>
              <Half
                label={`1–15 ${monthNameGen(r.month)} → получка`}
                days={r.manual.first ?? null} hint={r.calc.first}
                pay={r.pay21} payHint={r.hint21} amount={r.sum21} canEdit={canEdit}
                onDays={(v) => set(r.key, 'first', v)}
                onDate={(d) => r.pay21 && updatePaycheck(r.pay21.id, { date: d })}
              />
              <Half
                label={`16–${daysInMonth(year, r.month)} ${monthNameGen(r.month)} → получка`}
                days={r.manual.second ?? null} hint={r.calc.second}
                pay={r.pay6} payHint={r.hint6} amount={r.sum6} canEdit={canEdit}
                onDays={(v) => set(r.key, 'second', v)}
                onDate={(d) => r.pay6 && updatePaycheck(r.pay6.id, { date: d })}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Как это читается</h2></div>
        <div className="card-body">
          <div className="tiny muted">
            <p style={{ margin: '0 0 8px' }}>
              Строка — месяц, за который начислили, а не месяц, в который заплатили. У месяца две
              половины, и каждая едет в свою получку: <b>1–15</b> — в получку 21-го этого месяца,
              <b> 16 и дальше</b> — в получку 6-го следующего. Значит, первая получка любого
              месяца — это всегда вторая половина месяца прошлого.
            </p>
            <p style={{ margin: '0 0 8px' }}>
              Сумма получки — оклад, делённый на рабочие дни всего месяца и умноженный на
              рабочие дни половины.
            </p>
            <p style={{ margin: '0 0 8px' }}>
              Числа полей — рабочие дни. Серое число — расчёт по производственному календарю;
              впиши своё, и оно станет сильнее расчёта. Чтобы вернуться к расчёту, сотри поле.
            </p>
            <p style={{ margin: 0 }}>
              Дата рядом — день, когда деньги придут. По умолчанию это 6-е и 21-е, а если
              выпадает на выходной или праздник — ближайший рабочий день назад: отсюда и 5-е,
              и 4-е, и 31 декабря вместо 6 января. Правило знает не все переносы, поэтому дату
              можно поправить руками. Если в самой получке вбита сумма «вместо расчёта»,
              она сильнее и рабочих дней, и оклада.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
