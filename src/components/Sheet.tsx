import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { useHoldUpdates } from '../lib/pwa-update'

let openSheets = 0

// Whether any sheet is showing, so a prompt that opens by itself (Unfinished) waits its turn.
export const anySheetOpen = () => openSheets > 0

// Drag far enough (a quarter of the sheet) or flick fast enough down, and it closes.
const CLOSE_SHARE = 0.25
const FLICK_PX_PER_MS = 0.5
const FLICK_MIN_PX = 20

// Bottom sheet: backdrop tap, Escape or a swipe down on the handle/title closes it, all the same way.
// App updates wait until it's closed.
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useHoldUpdates()
  useEffect(() => {
    openSheets++
    return () => {
      openSheets--
    }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; t: number } | null>(null)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)

  const onDown = (e: PointerEvent) => {
    drag.current = { y: e.clientY, t: e.timeStamp }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onMove = (e: PointerEvent) => {
    if (drag.current) setOffset(Math.max(0, e.clientY - drag.current.y))
  }
  const onUp = (e: PointerEvent) => {
    const start = drag.current
    drag.current = null
    setDragging(false)
    if (!start) return
    const dy = e.clientY - start.y
    const speed = dy / Math.max(1, e.timeStamp - start.t)
    const height = panel.current?.offsetHeight ?? Infinity
    if (dy > height * CLOSE_SHARE || (dy > FLICK_MIN_PX && speed > FLICK_PX_PER_MS)) onClose()
    else setOffset(0)
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ transform: offset ? `translateY(${offset}px)` : undefined }}
        className={`relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl ${
          dragging ? '' : 'transition-transform duration-200'
        }`}
      >
        <div
          className="-mx-4 cursor-grab touch-none px-4 pt-3 select-none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300" aria-hidden />
          <h2 className="pb-4 text-lg font-semibold">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  )
}
