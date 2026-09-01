import { useMemo, useState } from 'react'
import { useBudget } from '../store'
import { accrualPeriod, computeSalary } from '../salary'
import { money, monthName, monthNameGen, plural, today } from '../format'
import { halfWorkdaysByCalendar, monthKey, workdaysInMonth, type MonthWorkdays } from '../workdays'

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

/**
 * Таблица рабочих дней. Всё привязано к месяцу начисления, а не к дате прихода денег:
 * дни 1–15 уезжают в получку 21-го этого месяца, дни 16–конец — в получку 6-го следующего.
 *
 * Начинаем с месяца, за который считается ближайшая неполученная получка, — а это,
 * когда впереди получка 6-го числа, прошлый месяц. Раньше не показываем: те деньги
 * уже пришли, и правка дней их не изменит.
 */
export function Workdays() {
  const { budget, canEdit, updateCalendar } = useBudget()
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
  const setYear = setPicked

  const view = useMemo(() => {
    if (!budget) return null
    const years = [...new Set(budget.paychecks.map((p) => p.periodYear))]
      .filter((y) => y >= start.year)
      .sort()
    const fromMonth = year === start.year ? start.month : 1
    const months = MONTHS.filter((m) => m >= fromMonth)
    const rows = months.map((m) => {
      const key = monthKey(year, m)
      const manual: MonthWorkdays = budget.calendar.months?.[key] ?? {}
      // Получка 21-го — за первую половину этого месяца, получка 6-го — за вторую половину.
      const second = budget.paychecks.find((p) => p.periodYear === year && p.periodMonth === m && p.slot === 2)
      const nextMonth = m === 12 ? 1 : m + 1
      const nextYear = m === 12 ? year + 1 : year
      const first = budget.paychecks.find(
        (p) => p.periodYear === nextYear && p.periodMonth === nextMonth && p.slot === 1,
      )
      return {
        month: m, key, manual,
        calc: {
          norm: workdaysInMonth(year, m, budget.calendar),
          first: halfWorkdaysByCalendar(year, m, 'first', budget.calendar),
          second: halfWorkdaysByCalendar(year, m, 'second', budget.calendar),
        },
        pay21: second ? computeSalary(second, budget.salary, budget.calendar) : null,
        pay6: first ? computeSalary(first, budget.salary, budget.calendar) : null,
        pinned: (second?.salaryOverride ?? null) !== null || (first?.salaryOverride ?? null) !== null,
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
    <div className="card">
      <div className="card-head"><h2>Рабочие дни</h2>
        <span className="hint">{filled ? `${filled} ${plural(filled, 'месяц', 'месяца', 'месяцев')} вбито` : 'по календарю'}</span>
      </div>
      <div className="card-body">
        <div className="tiny muted">
          Получка считается так: оклад делим на норму месяца и умножаем на рабочие дни половины.
          Пустое поле — считаем сами по производственному календарю; вписанное число всегда
          сильнее расчёта. Начинаю с месяца, за который считается ближайшая получка: деньги
          6-го числа — это вторая половина прошлого месяца. Что было раньше, не показываю —
          те получки уже пришли, и правка дней их не изменит.
        </div>

        <div className="picker" style={{ marginTop: 14 }}>
          <select value={year} onChange={(ev) => setYear(Number(ev.target.value))} aria-label="Год">
            {years.map((y) => <option key={y} value={y}>{y} год</option>)}
          </select>
        </div>

        <div className="wdhead">
          <span>Месяц</span>
          <span className="r">Норма</span>
          <span className="r">1–15</span>
          <span className="r">16–конец</span>
        </div>
        {rows.map((r) => (
          <div className="wdrow" key={r.key}>
            <span className="wd-name">{monthName(r.month)}</span>
            <DaysInput
              value={r.manual.norm ?? null} hint={r.calc.norm} disabled={!canEdit}
              onChange={(v) => set(r.key, 'norm', v)}
            />
            <DaysInput
              value={r.manual.first ?? null} hint={r.calc.first} disabled={!canEdit}
              onChange={(v) => set(r.key, 'first', v)}
            />
            <DaysInput
              value={r.manual.second ?? null} hint={r.calc.second} disabled={!canEdit}
              onChange={(v) => set(r.key, 'second', v)}
            />
            <span className="wd-note tiny muted">
              {r.pay21 && `получка 21 ${monthNameGen(r.month)} — ${money(r.pay21.amount)}`}
              {r.pay6 && `${r.pay21 ? ' · ' : ''}6 ${monthNameGen(r.month === 12 ? 1 : r.month + 1)} — ${money(r.pay6.amount)}`}
              {r.pinned && ' · где-то сумма вбита руками, расчёт не применяется'}
            </span>
          </div>
        ))}

        <div className="tiny muted" style={{ marginTop: 12 }}>
          Числа справа — сколько выйдет по расчёту с текущим окладом. Если в самой получке
          вбита сумма «вместо расчёта», она сильнее и этой таблицы.
        </div>
      </div>
    </div>
  )
}
