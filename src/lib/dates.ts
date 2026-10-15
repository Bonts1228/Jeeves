import type { ISODate, Weekday } from '../types'

// All dates are local calendar days.

export function isoDate(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISODate(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(date: ISODate, n: number): ISODate {
  const d = parseISODate(date)
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

export function weekdayOf(date: ISODate): Weekday {
  return parseISODate(date).getDay() as Weekday
}

// The first given weekday strictly after date (a week on if date is that weekday).
export function nextWeekday(date: ISODate, weekday: Weekday): ISODate {
  return addDays(date, ((weekday - weekdayOf(date) + 6) % 7) + 1)
}
