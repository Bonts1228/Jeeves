import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { briefState } from '../db/brief'
import { db, SETTINGS_KEY } from '../db/db'
import { addDays, isoDate } from '../lib/dates'
import { blockMinutes, formatDuration, minutesOfDay, toMinutes } from '../lib/time'
import type { Weekday } from '../types'

// Today's block templates and the way into tomorrow's brief. The day view comes in M4.
export function Plan() {
  const [today] = useState(() => new Date())
  const weekday = today.getDay() as Weekday
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_KEY))
  const areas = useLiveQuery(() => db.areas.toArray())
  const templates = useLiveQuery(() => db.blockTemplates.where('weekday').equals(weekday).toArray(), [weekday])
  const tomorrow = addDays(isoDate(today), 1)
  const brief = useLiveQuery(() => briefState(tomorrow), [tomorrow])

  if (!settings || !areas || !templates) return null

  const blocks = templates.sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  const blockTime = blocks.filter((b) => !b.protected).reduce((sum, b) => sum + blockMinutes(b), 0)
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? 'Unknown area'

  const briefDue = minutesOfDay(today) >= toMinutes(settings.briefTime)

  return (
    <div className="space-y-4">
      <Link
        to="/brief"
        className={`flex min-h-14 items-center justify-between rounded-xl px-4 ${
          briefDue && !brief?.confirmedAt ? 'bg-stone-900 text-white active:bg-stone-700' : 'bg-white active:bg-stone-50'
        }`}
      >
        <span className="font-medium">Tomorrow's brief</span>
        <span className={`text-sm ${briefDue && !brief?.confirmedAt ? 'text-stone-300' : 'text-stone-500'}`}>
          {brief?.confirmedAt ? 'Confirmed' : 'Review'}
        </span>
      </Link>
      <div>
        <p className="font-medium">
          {today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
        </p>
        <p className="text-sm text-stone-500">
          {formatDuration(settings.capacity[weekday])} capacity · {formatDuration(blockTime)} in blocks
        </p>
      </div>
      <ul className="space-y-2">
        {blocks.length === 0 && <li className="text-stone-500">No blocks today.</li>}
        {blocks.map((b) => (
          <li
            key={b.id}
            className={`flex min-h-14 items-center gap-3 rounded-xl px-4 py-3 ${
              b.protected ? 'bg-stone-100 text-stone-500' : 'bg-white'
            }`}
          >
            <span className="w-28 shrink-0 tabular-nums text-sm">
              {b.start}–{b.end}
            </span>
            <span className="flex-1 font-medium">{areaName(b.areaId)}</span>
            <span className="text-sm text-stone-500">{b.protected ? 'Protected' : formatDuration(blockMinutes(b))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
