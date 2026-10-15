import { beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal browser stand-ins: the app runs tests in node.
class HTMLInputElement {}
class HTMLTextAreaElement {}
class HTMLSelectElement {}
const listeners: Record<string, (() => void)[]> = {}
const on = (type: string, fn: () => void) => (listeners[type] ??= []).push(fn)
const doc = { activeElement: null as unknown, visibilityState: 'visible', addEventListener: on }
Object.assign(globalThis, { HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement, document: doc, window: { addEventListener: on } })

const updateSW = vi.fn(async () => {})
let hooks: { onNeedRefresh: () => void; onRegisteredSW: (url: string, r: unknown) => void }
vi.mock('virtual:pwa-register', () => ({
  registerSW: (opts: typeof hooks) => {
    hooks = opts
    return updateSW
  },
}))

const { holdUpdates, setupPwaUpdates } = await import('./pwa-update')

const background = () => {
  doc.visibilityState = 'hidden'
  listeners.visibilitychange.forEach((fn) => fn())
}
const foreground = () => {
  doc.visibilityState = 'visible'
  listeners.visibilitychange.forEach((fn) => fn())
}

describe('PWA updates', () => {
  beforeEach(() => {
    for (const k of Object.keys(listeners)) delete listeners[k]
    doc.activeElement = null
    doc.visibilityState = 'visible'
    updateSW.mockClear()
    setupPwaUpdates()
    hooks.onRegisteredSW('/sw.js', { update: async () => {} })
    listeners.pointerdown.forEach((fn) => fn()) // in use: past the launch grace period
    hooks.onNeedRefresh()
  })

  it('never reloads while in use, applies when backgrounded', () => {
    expect(updateSW).not.toHaveBeenCalled()
    background()
    expect(updateSW).toHaveBeenCalledWith(true)
  })

  it('skips the reload while a sheet is open, applies once closed and backgrounded', () => {
    const release = holdUpdates()
    background()
    foreground()
    expect(updateSW).not.toHaveBeenCalled()
    release()
    release() // double release doesn't unbalance holds
    listeners.pointerdown.forEach((fn) => fn())
    background()
    expect(updateSW).toHaveBeenCalledTimes(1)
  })

  it('skips the reload while a field has focus', () => {
    doc.activeElement = new HTMLInputElement()
    background()
    expect(updateSW).not.toHaveBeenCalled()
    doc.activeElement = null
    background()
    expect(updateSW).toHaveBeenCalledTimes(1)
  })
})
