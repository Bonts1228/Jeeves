import { useEffect } from 'react'
import { registerSW } from 'virtual:pwa-register'

// A new deploy installs in the background and is applied (reload) only while the app isn't in use:
// when it goes to the background, or just after launch / return to the foreground, before any tap.
// Never while a sheet is open or a field has focus: a half-typed capture survives the app switch.
const QUIET_MS = 3000

let holds = 0

// Hold updates until the returned release is called.
export function holdUpdates() {
  holds++
  let released = false
  return () => {
    if (!released) holds--
    released = true
  }
}

// Hold updates while the calling component is mounted (every Sheet does).
export function useHoldUpdates() {
  useEffect(holdUpdates, [])
}

function editing() {
  const el = document.activeElement
  return holds > 0 || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
}

export function setupPwaUpdates() {
  let ready = false
  let quietUntil = Date.now() + QUIET_MS

  const interacted = () => {
    quietUntil = 0
  }
  window.addEventListener('pointerdown', interacted, { capture: true })
  window.addEventListener('keydown', interacted, { capture: true })

  const apply = () => {
    if (!editing()) void updateSW(true)
  }

  const updateSW = registerSW({
    onNeedRefresh() {
      ready = true
      if (Date.now() < quietUntil) apply()
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          if (ready) apply()
          return
        }
        // Back in the foreground. iOS may have suspended us before a hidden-time reload finished.
        quietUntil = Date.now() + QUIET_MS
        if (ready) apply()
        else registration.update().catch(() => {}) // offline: try again next time
      })
    },
  })
}
