import { useMemo } from 'react'
import { useBudget } from '../store'
import { actual, byId, currentPaycheckId, nextPaycheck, planned, totals } from '../calc'
import { dayMonth, daysBetween, money, periodLabel, plural, today } from '../format'
import { Strip } from '../components/Strip'

export function Now({ onOpenPaycheck }: { onOpenPaycheck: (id: string) => void }) {
  const { budget } = useBudget()

  const view = useMemo(() => {
    if (!budget) return null
    const now = today()
    const id = currentPaycheckId(budget.paychecks, now)
    if (!id) return null
    const paycheck = budget.paychecks.find((p) => p.id === id)!
    const next = nextPaycheck(budget.paychecks, id)
    const t = totals(paycheck, budget)
    const mine = budget.entries.filter((e) => e.paycheckId === id && e.kind !== 'income')
    const cats = byId(budget.categories)
    const unpaid = mine.filter((e) => e.fact === null && planned(e) > 0)
      .sort((a, z) => planned(z) - planned(a))
    const paid = mine.filter((e) => e.fact !== null && e.fact !== 0)
    const incomes = budget.entries.filter((e) => e.paycheckId === id && e.kind === 'income')
    const strip = budget.paychecks
      .slice(Math.max(0, budget.paychecks.findIndex((p) => p.id === id) - 11),
             budget.paychecks.findIndex((p) => p.id === id) + 1)
      .map((p) => ({ id: p.id, date: p.date, value: totals(p, budget).free }))
    const daysLeft = next ? daysBetween(now, next.date) : null
    return { paycheck, next, t, unpaid, paid, incomes, cats, strip, daysLeft }
  }, [budget])

  if (!view) return <div className="center">Нет ни одной получки.</div>

  const { paycheck, next, t, unpaid, paid, incomes, cats, strip, daysLeft } = view
  const tone = t.free < 0 ? 'crit' : t.free < 5000 ? 'warn' : 'good'
  const perDay = daysLeft && daysLeft > 0 ? t.free / daysLeft : null
  const spentShare = t.actualOut > 0 ? Math.min(100, (t.spent / t.actualOut) * 100) : 0

  return (
    <div className="page">
      <div className="headline">
        <div className="eyebrow">{periodLabel(paycheck.periodYear, paycheck.periodMonth, paycheck.slot)}</div>
        <h1>Получка от {dayMonth(paycheck.date)}</h1>
        <p>
          {next
            ? `Следующая ${dayMonth(next.date)}${daysLeft !== null && daysLeft > 0
                ? ` — через ${daysLeft} ${plural(daysLeft, 'день', 'дня', 'дней')}`
                : ' — сегодня'}`
            : 'Следующая получка ещё не расписана'}
        </p>
      </div>

      <div className={`freebox ${tone}`}>
        <div className="label">{t.free < 0 ? 'Не хватает' : 'Свободно'}</div>
        <div className="value">{money(Math.abs(t.free))}</div>
        <div className="note">
          {t.free < 0
            ? 'Расписано больше, чем пришло. Нужно либо убрать траты, либо найти деньги.'
            : perDay !== null
              ? `Это ${money(perDay)} в день до следующей получки`
              : 'После всех расписанных трат'}
        </div>
      </div>

      <div className="pair">
        <div>
          <div className="k">Пришло</div>
          <div className="v">{money(t.income)}</div>
        </div>
        <div>
          <div className="k">Расписано</div>
          <div className="v">{money(t.actualOut)}</div>
        </div>
        <div>
          <div className="k">Обязательные</div>
          <div className="v">{money(t.required)}</div>
        </div>
        <div>
          <div className="k">Необязательные</div>
          <div className="v">{money(t.optional)}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h2>Осталось оплатить</h2>
          <span className="hint">{money(t.toPay)}</span>
        </div>
        <div className="card-body">
          <div className="meter" style={{ marginTop: 0 }}>
            <div className="track">
              <div className="seg-spent" style={{ width: `${spentShare}%` }} />
              <div className="seg-left" style={{ width: `${100 - spentShare}%` }} />
            </div>
            <div className="legend">
              <span><s style={{ background: 'var(--accent)' }} />уже потрачено {money(t.spent)}</span>
              <span><s style={{ background: 'var(--surface2)', border: '1px solid var(--line)' }} />
                впереди {money(t.toPay)}</span>
            </div>
          </div>

          <div className="rows" style={{ marginTop: 14 }}>
            {unpaid.length === 0 && <div className="tiny muted">Всё оплачено — по плану ничего не осталось.</div>}
            {unpaid.map((e) => (
              <div className="row" key={e.id}>
                <div>
                  <div className="name">{e.title || 'Без названия'}</div>
                  <div className="sub">
                    {cats[e.categoryId]?.name ?? 'Без категории'}
                    {e.kind === 'optional' ? ' · необязательная' : ''}
                  </div>
                </div>
                <div className="amount">{money(planned(e))}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {incomes.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Приходы кроме зарплаты</h2>
            <span className="hint">{money(t.extraIncome)}</span>
          </div>
          <div className="card-body">
            <div className="rows">
              {incomes.map((e) => (
                <div className="row" key={e.id}>
                  <div>
                    <div className="name">{e.title}</div>
                    <div className="sub">{cats[e.categoryId]?.name ?? ''}</div>
                  </div>
                  <div className="amount" style={{ color: 'var(--good)' }}>+{money(actual(e))}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {paid.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Уже потрачено</h2>
            <span className="hint">{money(t.spent)}</span>
          </div>
          <div className="card-body">
            <div className="rows">
              {paid.map((e) => (
                <div className="row done" key={e.id}>
                  <div>
                    <div className="name">{e.title || 'Без названия'}</div>
                    <div className="sub">
                      {e.plan !== null && e.fact !== null && Math.abs(e.fact - e.plan) > 0.5
                        ? `план ${money(e.plan)} → ${e.fact > e.plan ? 'больше' : 'меньше'} на ${money(Math.abs(e.fact - e.plan))}`
                        : 'по плану'}
                    </div>
                  </div>
                  <div className="amount">{money(e.fact ?? 0)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>Свободные деньги, последние получки</h2></div>
        <div className="card-body">
          <Strip points={strip} currentId={paycheck.id} />
          <div className="tiny muted" style={{ marginTop: 10 }}>
            Вниз — получки, где расписано больше, чем пришло.
          </div>
        </div>
      </div>

      <button className="btn ghost" style={{ marginTop: 16, width: '100%' }}
        onClick={() => onOpenPaycheck(paycheck.id)}>
        Открыть эту получку целиком
      </button>
    </div>
  )
}
