import { Link, Outlet, useLocation } from 'react-router-dom'
import { BottomBar } from './BottomBar'
import { GearIcon } from './icons'

const TITLES: Record<string, string> = { '/': 'Plan', '/backlog': 'Backlog' }

// Main screens: header with Settings link, content, bottom bar.
export function Layout() {
  const { pathname } = useLocation()
  return (
    <div className="mx-auto min-h-dvh max-w-md pb-[calc(5rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-stone-50/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
        <h1 className="py-3 text-2xl font-semibold">{TITLES[pathname]}</h1>
        <Link
          to="/settings"
          aria-label="Settings"
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-stone-500 active:bg-stone-200"
        >
          <GearIcon />
        </Link>
      </header>
      <main className="px-4">
        <Outlet />
      </main>
      <BottomBar />
    </div>
  )
}
