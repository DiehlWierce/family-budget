import { useMemo, useState } from 'react'
import { useBudget } from '../store'
import { categoryStats, currentPaycheckId, debtStats, groupStats, totals, yearStats } from '../calc'
import { dayMonth, money, moneyShort, plural, today } from '../format'
import { Strip } from '../components/Strip'

export function Analytics() {
  const { budget } = useBudget()
  const [year, setYear] = useState<number | 'all'>(new Date().getFullYear())
  const [showClosed, setShowClosed] = useState(false)

  const stats = useMemo(() => {
    if (!budget) return null
    return {
      years: yearStats(budget),
      cats: categoryStats(budget, year),
      groups: groupStats(budget, year),
      debts: debtStats(budget),
      strip: budget.paychecks.map((p) => ({
        id: p.id, date: p.date, value: totals(p, budget.entries).free,
      })),
      currentId: currentPaycheckId(budget.paychecks),
    }
  }, [budget, year])

  if (!budget || !stats) return <div className="center">Загрузка…</div>

  const { years, cats, groups, debts, strip, currentId } = stats
  const maxDebtShare = Math.max(0.01, ...years.map((y) => y.debtShare))
  const maxGroup = Math.max(1, ...groups.map((g) => g.total))
  const activeDebts = debts.filter((d) => d.active)
  const monthlyDebt = activeDebts.reduce((s, d) => s + d.monthly, 0)
  const freedom = activeDebts.length
    ? activeDebts.map((d) => d.lastDate).sort().slice(-1)[0]
    : null
  const withPairs = cats.filter((c) => c.pairs >= 3).sort(
    (a, z) => Math.abs(z.fact - z.plan) - Math.abs(a.fact - a.plan),
  )
  const availableYears = [...new Set(budget.paychecks.map((p) => p.periodYear))].sort()

  return (
    <div className="page">
      <div className="headline">
        <div className="eyebrow">Три года данных</div>
        <h1>Аналитика</h1>
        <p>{budget.paychecks.length} получек, {budget.entries.length} строк трат.</p>
      </div>

      <div className="card">
        <div className="card-head"><h2>Долговая нагрузка</h2>
          <span className="hint">доля от всего прихода</span>
        </div>
        <div className="card-body">
          <div className="bars">
            {years.map((y) => (
              <div className="bar" key={y.year}>
                <span className="k">{y.year}</span>
                <span className="track">
                  <span className="fill debt" style={{ width: `${(y.debtShare / maxDebtShare) * 100}%` }} />
                </span>
                <span className="v">{Math.round(y.debtShare * 100)}% · {moneyShort(y.debt)}</span>
              </div>
            ))}
          </div>
          <div className="tiny muted" style={{ marginTop: 12 }}>
            Сейчас платим {money(monthlyDebt)} в получку по {activeDebts.length}{' '}
            {plural(activeDebts.length, 'кредиту', 'кредитам', 'кредитам')}.
            {freedom && ` Дальше ${dayMonth(freedom)} ${freedom.slice(0, 4)} план заканчивается — не значит, что кредиты закрыты.`}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Кредиты</h2>
          <span className="hint">{activeDebts.length} активных</span>
        </div>
        <div className="card-body">
          <div className="rows">
            {(showClosed ? debts : activeDebts).map((d) => (
              <div className={'row' + (d.active ? '' : ' done')} key={d.category.id}>
                <div>
                  <div className="name">{d.category.name}</div>
                  <div className="sub">
                    {d.active
                      ? `расписано ещё ${moneyShort(d.remaining)} · по ${dayMonth(d.lastDate)} ${d.lastDate.slice(0, 4)}`
                      : `закрыт · всего ${moneyShort(d.paid)}`}
                  </div>
                </div>
                <div className="amount">{d.active ? money(d.monthly) : '—'}</div>
              </div>
            ))}
          </div>
          <button className="btn ghost" style={{ marginTop: 12, width: '100%' }}
            onClick={() => setShowClosed(!showClosed)}>
            {showClosed
              ? 'Скрыть закрытые'
              : `Показать ${debts.length - activeDebts.length} закрытых`}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Свободные деньги по всем получкам</h2></div>
        <div className="card-body">
          <Strip points={strip} currentId={currentId} />
          <div className="tiny muted" style={{ marginTop: 10 }}>
            {years.map((y) => `${y.year}: ${y.negatives} из ${y.paychecks} в минус`).join(' · ')}
          </div>
        </div>
      </div>

      <div className="section-title">
        Разрез по году
        <select
          value={String(year)}
          onChange={(ev) => setYear(ev.target.value === 'all' ? 'all' : Number(ev.target.value))}
          style={{
            marginLeft: 'auto', background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 4, padding: '5px 8px', fontSize: 14,
          }}
        >
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          <option value="all">все годы</option>
        </select>
      </div>

      <div className="card">
        <div className="card-head"><h2>Куда уходят деньги</h2></div>
        <div className="card-body">
          <div className="bars">
            {groups.map((g) => (
              <div className="bar" key={g.id}>
                <span className="k">{g.name}</span>
                <span className="track">
                  <span className="fill" style={{ width: `${(g.total / maxGroup) * 100}%` }} />
                </span>
                <span className="v">{moneyShort(g.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>План против факта</h2>
          <span className="hint">где ошибаешься системно</span>
        </div>
        <div className="card-body">
          {withPairs.length === 0 ? (
            <div className="tiny muted">
              За этот год мало строк с проставленным фактом — сравнивать нечего.
            </div>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Категория</th>
                    <th className="n">Пар</th>
                    <th className="n">План</th>
                    <th className="n">Факт</th>
                    <th className="n">Отклонение</th>
                  </tr>
                </thead>
                <tbody>
                  {withPairs.slice(0, 14).map((c) => (
                    <tr key={c.category.id}>
                      <td>{c.category.name}</td>
                      <td className="n">{c.pairs}</td>
                      <td className="n">{moneyShort(c.plan)}</td>
                      <td className="n">{moneyShort(c.fact)}</td>
                      <td className={'n ' + (c.deviation > 0 ? 'dev-over' : 'dev-under')}>
                        {c.deviation > 0 ? '+' : ''}{Math.round(c.deviation * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="tiny muted" style={{ marginTop: 10 }}>
            Плюс — тратишь больше, чем планируешь. Минус — закладываешь с запасом.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Итоги по годам</h2></div>
        <div className="card-body">
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Год</th>
                  <th className="n">Приход</th>
                  <th className="n">Обязательные</th>
                  <th className="n">Необязательные</th>
                  <th className="n">В минус</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td className="n">{moneyShort(y.income)}</td>
                    <td className="n">{moneyShort(y.required)}</td>
                    <td className="n">{moneyShort(y.optional)}</td>
                    <td className="n">{y.negatives} / {y.paychecks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tiny muted" style={{ marginTop: 10 }}>
            Годы, которые ещё не прошли целиком, включают запланированные вперёд получки.
          </div>
        </div>
      </div>

      <div className="tiny muted" style={{ marginTop: 18, textAlign: 'center' }}>
        Данные обновлены {new Date(budget.meta.updatedAt).toLocaleString('ru-RU')} · сегодня {dayMonth(today())}
      </div>
    </div>
  )
}
