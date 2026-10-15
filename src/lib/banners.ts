// The app's Undo banners, one slot per kind, so one kind never wipes another's Undo: ticking Done
// while an urgent capture's re-plan banner shows adds a second banner instead of replacing it.
// A new banner replaces only one of its own kind. Each clears itself after a few seconds, or when
// its Undo is used.

export type BannerKind = 'done' | 'replan'

export interface Shown {
  label: string
  undo: () => Promise<unknown>
}

export interface Banner extends Shown {
  kind: BannerKind
}

const SHOW_MS = 6000
const ORDER: BannerKind[] = ['replan', 'done'] // top to bottom

let banners: Banner[] = []
const timers = new Map<BannerKind, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()

const set = (kind: BannerKind, shown: Shown | null) => {
  const others = banners.filter((b) => b.kind !== kind)
  banners = shown ? [...others, { ...shown, kind }].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)) : others
  listeners.forEach((l) => l())
}

// Show a banner of this kind (replacing only that kind's), or clear that kind with null.
export function showBanner(shown: Shown | null, kind: BannerKind = 'done', ms = SHOW_MS) {
  clearTimeout(timers.get(kind))
  timers.delete(kind)
  set(kind, shown)
  if (shown) timers.set(kind, setTimeout(() => set(kind, null), ms))
}

export const currentBanners = () => banners

export const subscribeBanners = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
