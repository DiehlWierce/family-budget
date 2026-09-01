const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export const money = (v: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v)) + ' ₽'

export const moneyShort = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.0', '') + ' млн'
  if (a >= 10_000) return Math.round(v / 1000) + 'k'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v))
}

/** Доля в процентах: мелкое не схлопываем в «0%». */
export const percent = (v: number) => {
  const a = Math.abs(v) * 100
  if (a === 0) return '0%'
  if (a < 0.1) return (v < 0 ? '>−0,1%' : '<0,1%')
  if (a < 1) return (v * 100).toFixed(1).replace('.', ',') + '%'
  return Math.round(v * 100) + '%'
}

export const signed = (v: number) => (v > 0 ? '+' : '') + money(v)

export const dayMonth = (iso: string) => {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`
}

export const monthName = (m: number) => MONTHS_NOM[m - 1]

/** Родительный падеж: «с первого числа сентября». */
export const monthNameGen = (m: number) => MONTHS_GEN[m - 1]

export const periodLabel = (year: number, month: number, slot: number) =>
  `${MONTHS_NOM[month - 1]} ${year}, ${slot === 1 ? 'первая' : 'вторая'} получка`

export const today = () => new Date().toISOString().slice(0, 10)

export const daysBetween = (fromIso: string, toIso: string) =>
  Math.round(
    (new Date(toIso + 'T00:00:00').getTime() - new Date(fromIso + 'T00:00:00').getTime()) / 86_400_000,
  )

export const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}
