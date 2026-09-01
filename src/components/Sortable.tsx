import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

/**
 * Перетаскивание строк пальцем и мышью.
 *
 * Родной HTML5 drag на айфоне не работает вовсе, поэтому всё на pointer-событиях:
 * ручка захватывает указатель, строка едет за пальцем, соседи разъезжаются.
 * Ручке нужен `touch-action: none`, иначе Safari отдаст жест прокрутке страницы.
 */

export interface HandleProps {
  onPointerDown: (ev: ReactPointerEvent) => void
  onPointerMove: (ev: ReactPointerEvent) => void
  onPointerUp: (ev: ReactPointerEvent) => void
  onPointerCancel: (ev: ReactPointerEvent) => void
  className: string
  title: string
  'aria-label': string
}

interface Geometry { top: number; height: number; center: number }

interface DragState {
  id: string
  from: number
  to: number
  dy: number
  height: number
}

const EDGE = 80
const SPEED = 12

export function Sortable<T>({
  items, getId, disabled, onReorder, children,
}: {
  items: T[]
  getId: (item: T) => string
  disabled?: boolean
  onReorder: (from: number, to: number) => void
  children: (item: T, index: number, handle: HandleProps, dragging: boolean) => ReactNode
}) {
  const nodes = useRef(new Map<string, HTMLDivElement | null>())
  const geometry = useRef<Geometry[]>([])
  const origin = useRef(0)
  const pointerY = useRef(0)
  const scroller = useRef<number | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag

  const stopScroller = () => {
    if (scroller.current !== null) cancelAnimationFrame(scroller.current)
    scroller.current = null
  }

  useEffect(() => stopScroller, [])

  /** Куда встанет строка, если отпустить прямо сейчас. */
  const targetIndex = useCallback((from: number, dy: number) => {
    const g = geometry.current
    if (!g.length) return from
    const center = g[from].center + dy
    let to = from
    while (to > 0 && center < g[to - 1].center) to--
    while (to < g.length - 1 && center > g[to + 1].center) to++
    return to
  }, [])

  const track = useCallback(() => {
    const state = dragRef.current
    if (!state) return
    const dy = pointerY.current + window.scrollY - origin.current
    const to = targetIndex(state.from, dy)
    if (dy !== state.dy || to !== state.to) setDrag({ ...state, dy, to })
  }, [targetIndex])

  const autoscroll = useCallback(() => {
    const y = pointerY.current
    const below = y - (window.innerHeight - EDGE)
    const above = EDGE - y
    if (above > 0) window.scrollBy(0, -Math.min(SPEED, above / 3))
    else if (below > 0) window.scrollBy(0, Math.min(SPEED, below / 3))
    track()
    scroller.current = requestAnimationFrame(autoscroll)
  }, [track])

  const onPointerDown = (index: number) => (ev: ReactPointerEvent) => {
    if (disabled || ev.button > 0) return
    // preventDefault ниже не даст полю потерять фокус само — а несохранённая правка
    // из поля ввода при перетаскивании пропала бы.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    ev.preventDefault()
    const boxes = items.map((it) => nodes.current.get(getId(it))?.getBoundingClientRect() ?? null)
    if (boxes.some((b) => b === null)) return
    geometry.current = boxes.map((b) => ({
      top: b!.top + window.scrollY,
      height: b!.height,
      center: b!.top + window.scrollY + b!.height / 2,
    }))
    origin.current = ev.clientY + window.scrollY
    pointerY.current = ev.clientY
    try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch { /* мышь без захвата тоже сойдёт */ }
    setDrag({ id: getId(items[index]), from: index, to: index, dy: 0, height: geometry.current[index].height })
    stopScroller()
    scroller.current = requestAnimationFrame(autoscroll)
  }

  const onPointerMove = (ev: ReactPointerEvent) => {
    if (!dragRef.current) return
    ev.preventDefault()
    pointerY.current = ev.clientY
    track()
  }

  const finish = (ev: ReactPointerEvent) => {
    const state = dragRef.current
    stopScroller()
    if (!state) return
    try { ev.currentTarget.releasePointerCapture(ev.pointerId) } catch { /* уже отпущен */ }
    setDrag(null)
    if (state.to !== state.from) onReorder(state.from, state.to)
  }

  const shift = (index: number) => {
    if (!drag) return 0
    if (index === drag.from) return drag.dy
    if (drag.to > drag.from && index > drag.from && index <= drag.to) return -drag.height
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.height
    return 0
  }

  return (
    <div className={'sortable' + (drag ? ' dragging' : '')}>
      {items.map((item, i) => {
        const id = getId(item)
        const moving = drag?.from === i
        const dy = shift(i)
        return (
          <div
            key={id}
            ref={(el) => { nodes.current.set(id, el) }}
            className={'sortable-item' + (moving ? ' moving' : '')}
            style={{
              transform: dy ? `translateY(${dy}px)` : undefined,
              transition: drag && !moving ? 'transform .14s ease' : undefined,
            }}
          >
            {children(item, i, {
              onPointerDown: onPointerDown(i),
              onPointerMove,
              onPointerUp: finish,
              onPointerCancel: finish,
              className: 'draghandle',
              title: 'Перетащить',
              'aria-label': 'Перетащить строку',
            }, Boolean(moving))}
          </div>
        )
      })}
    </div>
  )
}
