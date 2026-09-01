import { useMemo, useState } from 'react'
import { useBudget } from '../store'
import { currentPaycheckId } from '../calc'
import { computeSalary } from '../salary'
import { dayMonth, money, monthName, plural, today } from '../format'
import { CategoryPicker } from '../components/CategoryPicker'
import { Sortable, type HandleProps } from '../components/Sortable'
import { Workdays } from './Workdays'
import type { Template } from '../types'

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/** Дальше 2027-го пока не считаем: год досчитывается кнопкой «Продлить». */
const HORIZONS = [2027, 2028, 2029, 2030]

const parseAmount = (raw: string): number => {
  const s = raw.replace(/\s|₽/g, '').replace(',', '.')
  const v = Number(s)
  return Number.isFinite(v) ? v : 0
}

function AmountCell({ value, onChange, disabled, className }: {
  value: number; onChange: (v: number) => void; disabled?: boolean; className?: string
}) {
  return (
    <input
      className={'amount ' + (className ?? 'e-plan')} inputMode="decimal" disabled={disabled}
      key={String(value)} defaultValue={String(value)}
      onBlur={(ev) => { const v = parseAmount(ev.target.value); if (v !== value) onChange(v) }}
      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
    />
  )
}

function TemplateRow({
  t, canEdit, yearly, handle, dragging, onPatch, onRemove,
}: {
  t: Template
  canEdit: boolean
  yearly: boolean
  handle: HandleProps
  dragging: boolean
  onPatch: (patch: Partial<Template>) => void
  onRemove: () => void
}) {
  return (
    <div className={'trow' + (dragging ? ' grabbed' : '')}>
      <input
        className="t-name" placeholder="на что" disabled={!canEdit}
        key={t.id + t.title} defaultValue={t.title}
        onBlur={(ev) => { if (ev.target.value !== t.title) onPatch({ title: ev.target.value }) }}
        onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
      />
      <AmountCell
        className="t-amt" value={t.amount} disabled={!canEdit}
        onChange={(v) => onPatch({ amount: v })}
      />
      <div className="t-when">
        {yearly && (
          <select
            value={t.month ?? 1} disabled={!canEdit} aria-label="Месяц"
            onChange={(ev) => onPatch({ month: Number(ev.target.value) })}
          >
            {MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        )}
        <select
          value={t.slot === 'both' ? 'both' : String(t.slot)} disabled={!canEdit} aria-label="В какую получку"
          onChange={(ev) => onPatch({
            slot: ev.target.value === 'both' ? 'both' : (Number(ev.target.value) as 1 | 2),
          })}
        >
          <option value="1">1-я получка</option>
          <option value="2">2-я получка</option>
          <option value="both">обе получки</option>
        </select>
      </div>
      <div className="t-what">
        <select
          value={t.kind} disabled={!canEdit} aria-label="Тип траты"
          onChange={(ev) => onPatch({ kind: ev.target.value as Template['kind'] })}
        >
          <option value="required">обязательная</option>
          <option value="optional">необязательная</option>
        </select>
        <CategoryPicker
          value={t.categoryId} disabled={!canEdit}
          onChange={(id) => onPatch({ categoryId: id })}
        />
      </div>
      {canEdit ? <button {...handle} type="button">⠿</button> : <span />}
      {canEdit
        ? <button className="del" title="Убрать из базы" onClick={onRemove}>×</button>
        : <span />}
    </div>
  )
}

export function Plan() {
  const {
    budget, canEdit, updateTemplate, addTemplate, removeTemplate, reorderTemplate,
    applyTemplateToPaychecks, updateSalary, extendTo,
  } = useBudget()
  const [horizon, setHorizon] = useState(HORIZONS[0])
  const [note, setNote] = useState<string | null>(null)
  const [sync, setSync] = useState<string | null>(null)

  const view = useMemo(() => {
    if (!budget) return null
    const last = budget.paychecks[budget.paychecks.length - 1]
    const future = budget.paychecks.filter((p) => p.date > today()).slice(0, 8)
    const byOrder = (a: Template, z: Template) => a.order - z.order
    const regular = budget.templates.filter((t) => t.freq === 'each').sort(byOrder)
    const yearly = budget.templates.filter((t) => t.freq === 'yearly').sort(byOrder)
    const perMonth = regular.reduce((s, t) => s + t.amount * (t.slot === 'both' ? 2 : 1), 0)
    const yearlySum = yearly.reduce((s, t) => s + t.amount, 0)

    const nowId = currentPaycheckId(budget.paychecks)
    const now = nowId ? budget.paychecks.find((p) => p.id === nowId) ?? null : null

    return { last, future, regular, yearly, perMonth, yearlySum, now }
  }, [budget])

  if (!budget || !view) return <div className="center">Загрузка…</div>
  const { last, future, regular, yearly, perMonth, yearlySum, now } = view
  const step = budget.salary.history[budget.salary.history.length - 1]

  // Правка базы всегда идёт с текущей получки: прошлое — записанная история, а ближайшая
  // получка — то, что ты сейчас живёшь, и её правка касается в первую очередь.
  const startId = now?.id ?? null

  const said = (n: number, what: string) => setSync(
    startId
      ? `${what}: тронуто ${n} ${plural(n, 'строка', 'строки', 'строк')}`
        + ` в получках начиная с текущей — ${dayMonth(now!.date)}.`
      : `${what}: правка легла в базу. Уже расписанные получки не тронуты.`,
  )

  const patch = (t: Template, p: Partial<Template>) => {
    const next = { ...t, ...p }
    if (!startId) { updateTemplate(t.id, p); said(0, `«${next.title || 'Без названия'}»`); return }
    said(applyTemplateToPaychecks(next, startId, 'upsert', t), `«${next.title || 'Без названия'}»`)
  }

  const drop = (t: Template) => {
    if (!startId) { removeTemplate(t.id); said(0, `«${t.title || 'Без названия'}» убрана`); return }
    said(applyTemplateToPaychecks(t, startId, 'remove', t), `«${t.title || 'Без названия'}» убрана`)
  }

  const add = (freq: 'each' | 'yearly', kind: Template['kind']) => {
    const group = freq === 'each' ? regular : yearly
    const order = group.length ? Math.max(...group.map((t) => t.order)) + 1 : freq === 'each' ? 50 : 200
    addTemplate({
      id: `tpl-${freq === 'each' ? 'e' : 'y'}-${Date.now().toString(36)}`,
      title: '',
      categoryId: kind === 'required' ? 'household' : 'other-x',
      kind, amount: 0, slot: 2, freq,
      month: freq === 'yearly' ? new Date().getMonth() + 1 : undefined,
      from: startId ?? last?.id ?? '2027-01-1',
      to: null, order,
    })
    setSync('Строка добавлена в базу. Впиши название и сумму — тогда она разойдётся по получкам.')
  }

  const doExtend = () => {
    const n = extendTo(horizon)
    setNote(n === 0
      ? `План уже расписан до конца ${horizon} года.`
      : `Добавлено ${n} ${plural(n, 'получка', 'получки', 'получек')} — план идёт до конца ${horizon} года.`)
  }

  const kinds: { kind: Template['kind']; title: string }[] = [
    { kind: 'required', title: 'Обязательные' },
    { kind: 'optional', title: 'Необязательные' },
  ]

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
              {HORIZONS.map((y) => (
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

          <div className="tiny muted" style={{ marginTop: 12 }}>
            Вперёд действует последний вбитый оклад — сам он не растёт. Повысили — добавь
            строку с датой, и все получки с этого дня пересчитаются.
          </div>
        </div>
      </div>

      <Workdays />

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
                      за {c.periodLabel} · {c.workdays} из {c.normWorkdays} раб. дней ·
                      оклад {money(c.monthly)}
                      {p.salaryOverride !== null ? ' · вбито руками' : ''}
                    </div>
                  </div>
                  <div className="amount">{money(p.salaryOverride ?? c.amount)}</div>
                </div>
              )
            })}
          </div>
          <div className="tiny muted" style={{ marginTop: 12 }}>
            Получка 6-го числа — это вторая половина прошлого месяца, получка 21-го — первая
            половина этого. Рабочие дни и даты правятся в блоке выше.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Регулярные траты</h2>
          <span className="hint">{money(perMonth)} в месяц</span>
        </div>
        <div className="card-body">
          <div className="tiny muted" style={{ marginBottom: 12 }}>
            Правка отсюда идёт с текущей получки{now ? ` — ${dayMonth(now.date)}` : ''} и дальше.
            Прошлое не меняется никогда. Там, где факт уже проставлен, правятся только название и
            категория — сумма остаётся той, что была на самом деле.
          </div>
          {sync && <div className="banner" style={{ marginBottom: 12 }}>{sync}</div>}
          <div className="trow head">
            <span>Трата</span><span className="r">Сумма</span><span>Когда</span>
            <span>Что это</span><span /><span />
          </div>
          {kinds.map(({ kind, title }) => {
            const group = regular.filter((t) => t.kind === kind)
            return (
              <div key={kind}>
                <div className="section-title" style={{ marginTop: 14 }}>{title}
                  <span className="total">
                    {money(group.reduce((s, t) => s + t.amount * (t.slot === 'both' ? 2 : 1), 0))}
                  </span>
                </div>
                {group.length === 0 && <div className="tiny muted" style={{ padding: '6px 0' }}>Пусто.</div>}
                <Sortable
                  items={group} getId={(t) => t.id} disabled={!canEdit}
                  onReorder={(from, to) => reorderTemplate(from, to, group.map((x) => x.id))}
                >
                  {(t, _i, handle, dragging) => (
                    <TemplateRow
                      t={t} canEdit={canEdit} yearly={false} handle={handle} dragging={dragging}
                      onPatch={(p) => patch(t, p)} onRemove={() => drop(t)}
                    />
                  )}
                </Sortable>
                {canEdit && (
                  <button className="addbtn" onClick={() => add('each', kind)}>
                    + добавить {kind === 'required' ? 'обязательную' : 'необязательную'} трату
                  </button>
                )}
              </div>
            )
          })}
          <div className="tiny muted" style={{ marginTop: 14 }}>
            «Когда» — в какую получку месяца уходит трата. Сумма указывается на одну получку:
            «обе получки» значит, что столько уйдёт и 6-го, и 21-го. Что означает каждая
            категория и что в неё попало — в «Настройках», раздел «Категории».
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Ежегодные события</h2>
          <span className="hint">{money(yearlySum)} за год</span>
        </div>
        <div className="card-body">
          <div className="trow head">
            <span>Событие</span><span className="r">Сумма</span><span>Месяц и получка</span>
            <span>Что это</span><span /><span />
          </div>
          {MONTHS.filter((m) => yearly.some((t) => t.month === m)).map((m) => {
            const group = yearly.filter((t) => t.month === m)
            return (
              <div key={m}>
                <div className="section-title" style={{ marginTop: 14 }}>{monthName(m)}
                  <span className="total">{money(group.reduce((s, t) => s + t.amount, 0))}</span>
                </div>
                <Sortable
                  items={group} getId={(t) => t.id} disabled={!canEdit}
                  onReorder={(from, to) => reorderTemplate(from, to, group.map((x) => x.id))}
                >
                  {(t, _i, handle, dragging) => (
                    <TemplateRow
                      t={t} canEdit={canEdit} yearly handle={handle} dragging={dragging}
                      onPatch={(p) => patch(t, p)} onRemove={() => drop(t)}
                    />
                  )}
                </Sortable>
              </div>
            )
          })}
          {yearly.length === 0 && <div className="tiny muted" style={{ padding: '6px 0' }}>Пусто.</div>}
          {canEdit && (
            <button className="addbtn" style={{ marginTop: 14 }} onClick={() => add('yearly', 'optional')}>
              + добавить ежегодное событие
            </button>
          )}
          <div className="tiny muted" style={{ marginTop: 12 }}>
            Событие ложится в выбранный месяц каждого года: назови его, поставь месяц, получку
            и сколько уходит за раз.
          </div>
        </div>
      </div>
    </div>
  )
}
