import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Capture } from './Capture'
import { BacklogIcon, PlanIcon, PlusIcon } from './icons'

const tab = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
    isActive ? 'text-stone-900' : 'text-stone-400'
  }`

export function BottomBar() {
  const [capturing, setCapturing] = useState(false)
  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <div className="mx-auto flex max-w-md items-center px-4">
          <NavLink to="/" end className={tab}>
            <PlanIcon />
            Plan
          </NavLink>
          <div className="flex flex-1 justify-center">
            <button
              type="button"
              aria-label="Quick capture"
              onClick={() => setCapturing(true)}
              className="flex h-14 w-14 -translate-y-3 items-center justify-center rounded-full bg-stone-900 text-white shadow-lg active:bg-stone-700"
            >
              <PlusIcon />
            </button>
          </div>
          <NavLink to="/backlog" className={tab}>
            <BacklogIcon />
            Backlog
          </NavLink>
        </div>
      </nav>
      {capturing && <Capture onClose={() => setCapturing(false)} />}
    </>
  )
}
