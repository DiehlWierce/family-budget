export type Kind = 'required' | 'optional' | 'income'

export interface Paycheck {
  id: string
  /** Дата фактического прихода денег. */
  date: string
  periodYear: number
  periodMonth: number
  /** 1 — получка «6 числа», 2 — «21 числа». */
  slot: 1 | 2
  /** Рассчитанная сумма. */
  salaryPlan: number
  /** Сколько реально пришло, если отличается от расчёта. */
  salaryFact: number | null
  legacy?: {
    column: string
    declaredSpend: number | null
    declaredRest: number | null
    entriesSum: number
  }
}

export interface Entry {
  id: string
  paycheckId: string
  kind: Kind
  categoryId: string
  title: string
  plan: number | null
  fact: number | null
  order: number
}

export interface Category {
  id: string
  name: string
  group: string
  groupName: string
}

export interface Group {
  id: string
  name: string
}

export interface Meta {
  updatedAt: string
  source: string
}

export interface Budget {
  meta: Meta
  paychecks: Paycheck[]
  entries: Entry[]
  categories: Category[]
  groups: Group[]
}

export interface GithubConfig {
  owner: string
  repo: string
  branch: string
  token: string
}
