import { NavLink } from 'react-router-dom'
import { BacklogIcon, PlanIcon, PlusIcon } from './icons'

const tab = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
    isActive ? 'text-stone-900' : 'text-stone-400'
  }`

export function BottomBar() {
  return (
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
          {/* Quick capture arrives in M2 */}
          <button
            type="button"
            disabled
            aria-label="Quick capture (coming soon)"
            className="flex h-14 w-14 -translate-y-3 items-center justify-center rounded-full bg-stone-900 text-white shadow-lg disabled:opacity-40"
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
  )
}
