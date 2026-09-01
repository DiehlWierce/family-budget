import type { SalaryConfig } from './salary'
import type { CalendarOverrides } from './workdays'

export type Kind = 'required' | 'optional' | 'income'

export interface Paycheck {
  id: string
  /** Дата фактического прихода денег. */
  date: string
  periodYear: number
  periodMonth: number
  /** 1 — получка «6 числа», 2 — «21 числа». */
  slot: 1 | 2
  /** Ручная сумма вместо расчёта по окладу и рабочим дням. */
  salaryOverride: number | null
  /** Сколько реально пришло. */
  salaryFact: number | null
  /** Получка создана планировщиком, а не перенесена из таблицы. */
  generated?: boolean
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
  /** Из какого шаблона выросла строка. У перенесённых из таблицы — null. */
  templateId?: string | null
  kind: Kind
  categoryId: string
  title: string
  plan: number | null
  fact: number | null
  /** Заметка к строке: чем набралась сумма. Живёт только в своей получке. */
  note?: string
  order: number
}

export interface Category {
  id: string
  name: string
  group: string
  groupName: string
  /** Убрана из выбора: закрытый кредит, старое название. История сохраняется. */
  archived?: boolean
}

export interface Group {
  id: string
  name: string
  /** Порядок в списках. Меньше — выше. */
  order?: number
  /** Пояснение: что вообще сюда попадает. */
  note?: string
}

export interface Template {
  id: string
  title: string
  categoryId: string
  kind: 'required' | 'optional'
  amount: number
  /** 1 — только первая получка месяца, 2 — только вторая, 'both' — обе. */
  slot: 1 | 2 | 'both'
  /** 'each' — в каждую такую получку, 'yearly' — раз в год в месяце month. */
  freq: 'each' | 'yearly'
  month?: number
  /** id получки, с которой действует, включительно. */
  from: string
  /** id получки, по которую действует, включительно. null — бессрочно. */
  to: string | null
  order: number
  note?: string
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
  templates: Template[]
  salary: SalaryConfig
  calendar: CalendarOverrides
}

export interface GithubConfig {
  owner: string
  repo: string
  branch: string
  token: string
}

export type { SalaryConfig, CalendarOverrides }
