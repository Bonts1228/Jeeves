import type { Minutes, Weekday } from '../types'

export const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6]
// Display order: Monday first
export const WEEKDAYS_MON_FIRST: Weekday[] = [1, 2, 3, 4, 5, 6, 0]

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export function toMinutes(hhmm: string): Minutes {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function blockMinutes(b: { start: string; end: string }): Minutes {
  return toMinutes(b.end) - toMinutes(b.start)
}

export function formatDuration(mins: Minutes): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

export function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end)
}

export function fromMinutes(mins: Minutes): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

export function minutesOfDay(d: Date): Minutes {
  return d.getHours() * 60 + d.getMinutes()
}
