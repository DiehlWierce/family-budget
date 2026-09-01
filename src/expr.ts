/**
 * Маленький калькулятор для полей с суммами: «=10+10+10», «10+10+10=» и просто
 * «10+10+10» дают 30. Считаем сами, без eval: в поле попадает что угодно,
 * а выполнять чужой текст ради сложения незачем.
 */

const ALLOWED = /^[0-9\s.,+\-*/()₽]+$/

interface Cursor { s: string; i: number }

const peek = (p: Cursor) => p.s[p.i]

function number(p: Cursor): number | null {
  const start = p.i
  while (p.i < p.s.length && /[0-9.]/.test(p.s[p.i])) p.i++
  if (p.i === start) return null
  const v = Number(p.s.slice(start, p.i))
  return Number.isFinite(v) ? v : null
}

function factor(p: Cursor): number | null {
  const sign = peek(p) === '-' ? -1 : 1
  if (peek(p) === '-' || peek(p) === '+') p.i++
  if (peek(p) === '(') {
    p.i++
    const inner = expression(p)
    if (inner === null || peek(p) !== ')') return null
    p.i++
    return sign * inner
  }
  const n = number(p)
  return n === null ? null : sign * n
}

function term(p: Cursor): number | null {
  let acc = factor(p)
  if (acc === null) return null
  while (peek(p) === '*' || peek(p) === '/') {
    const op = peek(p)
    p.i++
    const rhs = factor(p)
    if (rhs === null) return null
    if (op === '/' && rhs === 0) return null
    acc = op === '*' ? acc * rhs : acc / rhs
  }
  return acc
}

function expression(p: Cursor): number | null {
  let acc = term(p)
  if (acc === null) return null
  while (peek(p) === '+' || peek(p) === '-') {
    const op = peek(p)
    p.i++
    const rhs = term(p)
    if (rhs === null) return null
    acc = op === '+' ? acc + rhs : acc - rhs
  }
  return acc
}

/**
 * Число из строки. Возвращает null, если это не арифметика целиком, —
 * тогда текст остаётся текстом.
 */
export function evalExpr(raw: string): number | null {
  let s = raw.trim()
  if (s.startsWith('=')) s = s.slice(1)
  if (s.endsWith('=')) s = s.slice(0, -1)
  if (!s || !ALLOWED.test(s)) return null
  // Пробелы и «₽» — оформление, запятая у нас десятичная.
  s = s.replace(/[\s₽]/g, '').replace(/,/g, '.')
  // Строку набирают на ходу: «450+1200+» — это ещё 1650, а не ошибка.
  s = s.replace(/[+\-*/]+$/, '')
  if (!s) return null
  const p: Cursor = { s, i: 0 }
  const v = expression(p)
  if (v === null || p.i !== s.length || !Number.isFinite(v)) return null
  return Math.round(v * 100) / 100
}

/** Введённое в поле суммы: пусто — null, иначе арифметика. */
export const parseAmount = (raw: string): number | null =>
  raw.trim() === '' ? null : evalExpr(raw)
