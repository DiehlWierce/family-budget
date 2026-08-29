import { dayMonth, money } from '../format'

export interface StripPoint {
  id: string
  date: string
  value: number
}

/**
 * Полоса получек: столбик вверх — остались деньги, вниз — кассовый разрыв.
 * Масштаб корневой, иначе один провал на 21 000 съедает всю остальную картину.
 */
export function Strip({ points, currentId }: { points: StripPoint[]; currentId?: string | null }) {
  const max = Math.max(1, ...points.map((p) => Math.sqrt(Math.abs(p.value))))
  return (
    <div className="strip-scroll"><div className="strip">
      {points.map((p) => {
        const h = Math.max(2, Math.round((Math.sqrt(Math.abs(p.value)) / max) * 100))
        return (
          <div
            key={p.id}
            className={'col' + (p.id === currentId ? ' here' : '')}
            title={`${dayMonth(p.date)} — ${money(p.value)}`}
          >
            <div className="half top">{p.value >= 0 && <i className="up" style={{ height: `${h}%` }} />}</div>
            <div className="half bot">{p.value < 0 && <i className="dn" style={{ height: `${h}%` }} />}</div>
          </div>
        )
      })}
    </div></div>
  )
}
