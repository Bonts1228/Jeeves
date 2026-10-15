import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentBanners, showBanner } from './banners'

const undo = async () => {}

describe('Undo banners', () => {
  afterEach(() => {
    showBanner(null, 'done')
    showBanner(null, 'replan')
    vi.useRealTimers()
  })

  it('a tick while the re-plan banner shows adds its own banner; the re-plan Undo stays', () => {
    showBanner({ label: 'Due today: Call bank → Work 14:00', undo }, 'replan')
    showBanner({ label: '✓ Draft memo', undo }, 'done')
    showBanner(null, 'done') // the next tick clears only the tick banner
    showBanner({ label: '✓ Tidy inbox', undo }, 'done')
    expect(currentBanners().map((b) => [b.kind, b.label])).toEqual([
      ['replan', 'Due today: Call bank → Work 14:00'],
      ['done', '✓ Tidy inbox'],
    ])
  })

  it('a new banner replaces only its own kind', () => {
    showBanner({ label: 'first re-plan', undo }, 'replan')
    showBanner({ label: '✓ a', undo }, 'done')
    showBanner({ label: 'second re-plan', undo }, 'replan')
    expect(currentBanners().map((b) => b.label)).toEqual(['second re-plan', '✓ a'])
  })

  it('each kind expires on its own clock', () => {
    vi.useFakeTimers()
    showBanner({ label: 're-plan', undo }, 'replan')
    vi.advanceTimersByTime(4000)
    showBanner({ label: '✓ a', undo }, 'done') // doesn't restart or end the re-plan banner
    vi.advanceTimersByTime(2000)
    expect(currentBanners().map((b) => b.label)).toEqual(['✓ a'])
    vi.advanceTimersByTime(4000)
    expect(currentBanners()).toEqual([])
  })
})
