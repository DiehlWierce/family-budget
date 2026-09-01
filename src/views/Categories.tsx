import { useMemo, useState } from 'react'
import { useBudget } from '../store'
import { actual, byId } from '../calc'
import { dayMonth, money, moneyShort, plural, today } from '../format'
import type { Category } from '../types'

interface Usage {
  entries: number
  total: number
  lastDate: string | null
  future: boolean
  templates: number
  titles: [string, number][]
}

/**
 * Разбор категорий: крупная категория → подкатегория → название траты.
 * Крупных мало, и они не меняются; подкатегория отвечает «что это за трата»;
 * название строки в получке — деталь и живёт само по себе.
 */
export function Categories() {
  const {
    budget, canEdit, updateCategory, addCategory, mergeCategories, updateGroup, addGroup,
  } = useBudget()
  const [open, setOpen] = useState<string | null>(null)
  const [mergeTo, setMergeTo] = useState<Record<string, string>>({})
  const [done, setDone] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const view = useMemo(() => {
    if (!budget) return null
    const now = today()
    const pays = byId(budget.paychecks)
    const usage = new Map<string, Usage>()
    const ensure = (id: string) => {
      const hit = usage.get(id)
      if (hit) return hit
      const fresh: Usage = { entries: 0, total: 0, lastDate: null, future: false, templates: 0, titles: [] }
      usage.set(id, fresh)
      return fresh
    }
    const titles = new Map<string, Map<string, number>>()
    for (const e of budget.entries) {
      const p = pays[e.paycheckId]
      if (!p) continue
      const u = ensure(e.categoryId)
      u.entries += 1
      u.total += actual(e)
      if (!u.lastDate || p.date > u.lastDate) u.lastDate = p.date
      if (p.date > now) u.future = true
      const t = titles.get(e.categoryId) ?? new Map<string, number>()
      const key = e.title || 'Без названия'
      t.set(key, (t.get(key) ?? 0) + 1)
      titles.set(e.categoryId, t)
    }
    for (const t of budget.templates) ensure(t.categoryId).templates += 1
    for (const [id, t] of titles) {
      ensure(id).titles = [...t.entries()].sort((a, z) => z[1] - a[1])
    }

    const cats = budget.categories
    const groups = [...budget.groups].sort((a, z) => (a.order ?? 0) - (z.order ?? 0))
      .map((g) => ({
        group: g,
        items: cats.filter((c) => c.group === g.id).sort((a, z) => a.name.localeCompare(z.name, 'ru')),
      }))

    return { groups, usage, cats }
  }, [budget])

  if (!budget || !view) return null
  const { groups, usage, cats } = view

  const stat = (c: Category) => usage.get(c.id) ?? {
    entries: 0, total: 0, lastDate: null, future: false, templates: 0, titles: [],
  }

  return (
    <>
      <div className="card">
        <div className="card-head"><h2>Категории</h2>
          <span className="hint">{cats.filter((c) => !c.archived).length} живых</span>
        </div>
        <div className="card-body">
          <div className="tiny muted">
            Три уровня. <b>Крупная категория</b> — их мало и они не меняются: Долги, Жильё, Еда.
            <b> Подкатегория</b> отвечает, что это за трата: «Ипотека», «Психолог».
            <b> Название строки</b> в получке — деталь: «На анализы», «Подарок Юле». Названия
            свободные, категорию они не задают: одна и та же подкатегория собирает сколько угодно
            разных названий.
          </div>
        </div>
      </div>

      {done && <div className="banner" style={{ marginTop: 14 }}>{done}</div>}

      <label className="checkline" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={showArchived} onChange={(ev) => setShowArchived(ev.target.checked)} />
        <span className="tiny">Показывать архив</span>
      </label>

      {groups.map(({ group, items }) => {
        const live = items.filter((c) => showArchived || !c.archived)
        // Пустую крупную категорию показываем: в неё ещё нечего было положить.
        if (!live.length && items.length) return null
        const total = items.reduce((s, c) => s + stat(c).total, 0)
        return (
          <div className="card" key={group.id}>
            <div className="card-head">
              <input
                className="groupname" disabled={!canEdit}
                key={group.id + group.name} defaultValue={group.name}
                onBlur={(ev) => {
                  if (ev.target.value.trim() && ev.target.value !== group.name) {
                    updateGroup(group.id, { name: ev.target.value.trim() })
                  }
                }}
              />
              <span className="hint">{moneyShort(total)}</span>
            </div>
            <div className="card-body">
              {live.map((c) => {
                const u = stat(c)
                const expanded = open === c.id
                return (
                  <div className={'catrow' + (c.archived ? ' archived' : '')} key={c.id}>
                    <div className="catrow-head">
                      <input
                        className="catname" disabled={!canEdit}
                        key={c.id + c.name} defaultValue={c.name}
                        onBlur={(ev) => {
                          if (ev.target.value.trim() && ev.target.value !== c.name) {
                            updateCategory(c.id, { name: ev.target.value.trim() })
                          }
                        }}
                      />
                      <span className="tiny muted num">
                        {u.entries} {plural(u.entries, 'строка', 'строки', 'строк')} · {moneyShort(u.total)}
                      </span>
                      <button className="linkbtn" onClick={() => setOpen(expanded ? null : c.id)}>
                        {expanded ? 'свернуть' : 'подробнее'}
                      </button>
                    </div>
                    {expanded && (
                      <div className="catrow-body">
                        <div className="tiny muted">
                          {u.titles.length
                            ? <>Что сюда попало: {u.titles.slice(0, 8).map(([t, n]) => `${t} (${n})`).join(', ')}
                              {u.titles.length > 8 ? ` и ещё ${u.titles.length - 8}` : ''}</>
                            : 'Пока ни одной строки.'}
                        </div>
                        <div className="tiny muted" style={{ marginTop: 4 }}>
                          {u.lastDate ? `Последний раз ${dayMonth(u.lastDate)} ${u.lastDate.slice(0, 4)}` : ''}
                          {u.future ? ' · есть и в планах впереди' : ''}
                          {u.templates ? ` · в базе плана: ${u.templates}` : ''}
                          {u.total ? ` · всего ${money(u.total)}` : ''}
                        </div>
                        {canEdit && (
                          <div className="catrow-actions">
                            <label className="field">
                              <span>Крупная категория</span>
                              <select
                                value={c.group}
                                onChange={(ev) => updateCategory(c.id, { group: ev.target.value })}
                              >
                                {budget.groups.map((g) => (
                                  <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="field">
                              <span>Слить с другой</span>
                              <select
                                value={mergeTo[c.id] ?? ''}
                                onChange={(ev) => setMergeTo({ ...mergeTo, [c.id]: ev.target.value })}
                              >
                                <option value="">— выбери —</option>
                                {cats.filter((x) => x.id !== c.id && !x.archived).map((x) => (
                                  <option key={x.id} value={x.id}>{x.groupName} · {x.name}</option>
                                ))}
                              </select>
                            </label>
                            <div className="catrow-buttons">
                              <button
                                className="btn ghost" disabled={!mergeTo[c.id]}
                                onClick={() => {
                                  const into = mergeTo[c.id]
                                  const n = mergeCategories([c.id], into)
                                  setMergeTo({ ...mergeTo, [c.id]: '' })
                                  setOpen(null)
                                  setDone(`«${c.name}» слита с «${cats.find((x) => x.id === into)?.name}»:`
                                    + ` ${n} ${plural(n, 'строка переехала', 'строки переехали', 'строк переехало')}.`)
                                }}
                              >Слить</button>
                              <button
                                className="btn ghost"
                                onClick={() => updateCategory(c.id, { archived: !c.archived })}
                              >{c.archived ? 'Вернуть из архива' : 'В архив'}</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {canEdit && (
                <button
                  className="addbtn"
                  onClick={() => addCategory({
                    id: `cat-${Date.now().toString(36)}`,
                    name: 'Новая подкатегория',
                    group: group.id,
                    groupName: group.name,
                  })}
                >+ подкатегория в «{group.name}»</button>
              )}
            </div>
          </div>
        )
      })}

      {canEdit && (
        <button
          className="addbtn" style={{ marginTop: 14 }}
          onClick={() => addGroup({
            id: `grp-${Date.now().toString(36)}`,
            name: 'Новая крупная категория',
            order: (Math.max(0, ...budget.groups.map((g) => g.order ?? 0)) + 10),
          })}
        >+ крупная категория</button>
      )}
    </>
  )
}
