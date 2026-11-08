import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { ensureBlocks } from '../db/blocks'
import { db } from '../db/db'
import type { ISODate } from '../types'

// Everything the day view and the Focus block read for a date, live. Makes the date's blocks first
// (a write, so not inside a live query). Undefined until loaded.
export function useDay(date: ISODate) {
  const [ready, setReady] = useState<ISODate | null>(null)
  useEffect(() => {
    let live = true
    ensureBlocks(date).then(() => live && setReady(date))
    return () => {
      live = false
    }
  }, [date])

  const areas = useLiveQuery(() => db.areas.toArray())
  const goals = useLiveQuery(() => db.goals.toArray())
  const projects = useLiveQuery(() => db.projects.toArray())
  const blocks = useLiveQuery(() => db.blocks.where('date').equals(date).toArray(), [date])
  const tasks = useLiveQuery(() => db.tasks.where('date').equals(date).toArray(), [date])
  // All non-deleted tasks, for goal and project numbers
  const pathTasks = useLiveQuery(() => db.tasks.filter((t) => t.status !== 'deleted').toArray())
  const logs = useLiveQuery(() => db.logEntries.toArray())

  if (ready !== date || !areas || !goals || !projects || !blocks || !tasks || !pathTasks || !logs) return undefined
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? 'Area'
  return { areas, areaName, goals, projects, blocks, tasks, pathTasks, logs }
}
