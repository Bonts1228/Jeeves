import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, SETTINGS_KEY } from '../db/db'
import { blockMinutes, formatDuration, toMinutes } from '../lib/time'
import type { Weekday } from '../types'

// M1: shows today's block templates. Brief and tasks come in M3/M4.
export function Plan() {
  const [today] = useState(() => new Date())
  const weekday = today.getDay() as Weekday
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_KEY))
  const areas = useLiveQuery(() => db.areas.toArray())
  const templates = useLiveQuery(() => db.blockTemplates.where('weekday').equals(weekday).toArray(), [weekday])

  if (!settings || !areas || !templates) return null

  const blocks = templates.sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  const blockTime = blocks.filter((b) => !b.protected).reduce((sum, b) => sum + blockMinutes(b), 0)
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? 'Unknown area'

  return (
    <div className="space-y-4">
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
