import { useMemo } from 'react'
import { useBudget } from '../store'
import type { Budget, Category } from '../types'

export const INCOME_GROUP = 'income'

export interface GroupedCategories {
  group: { id: string; name: string }
  items: Category[]
}

/**
 * Категории, разложенные по крупным категориям.
 * Убранные в архив не показываем — кроме той, что уже стоит в строке:
 * иначе правка строки молча переставила бы категорию.
 */
export function groupedCategories(b: Budget, income: boolean, keep?: string): GroupedCategories[] {
  const names = new Map(b.groups.map((g) => [g.id, g]))
  const order = (id: string) => names.get(id)?.order ?? 999
  const pool = b.categories.filter((c) => (c.group === INCOME_GROUP) === income)
    .filter((c) => !c.archived || c.id === keep)
  const byGroup = new Map<string, Category[]>()
  for (const c of pool) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c])
  return [...byGroup.entries()]
    .sort((a, z) => order(a[0]) - order(z[0]))
    .map(([id, items]) => ({
      group: { id, name: names.get(id)?.name ?? items[0]?.groupName ?? id },
      items: [...items].sort((a, z) => a.name.localeCompare(z.name, 'ru')),
    }))
}

export function CategoryPicker({
  value, income, onChange, disabled, className,
}: {
  value: string
  income?: boolean
  onChange: (id: string) => void
  disabled?: boolean
  className?: string
}) {
  const { budget } = useBudget()
  const tree = useMemo(
    () => (budget ? groupedCategories(budget, Boolean(income), value) : []),
    [budget, income, value],
  )
  const known = tree.some((g) => g.items.some((c) => c.id === value))

  return (
    <select
      className={className} value={value} disabled={disabled} aria-label="Категория"
      onChange={(ev) => onChange(ev.target.value)}
    >
      {!known && <option value={value}>Категория не найдена</option>}
      {tree.map((g) => (
        <optgroup key={g.group.id} label={g.group.name}>
          {g.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  )
}
