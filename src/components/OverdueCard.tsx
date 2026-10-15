import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { deleteTask } from '../db/tasks'
import { capitalise, dayLabel } from '../lib/task-fields'
import { formatDuration } from '../lib/time'
import { overdueTasks } from '../lib/unfinished'
import type { ID, ISODate, Task } from '../types'
import { MoveSheet } from './MoveSheet'
import { dangerBtn, secondaryBtn } from './ui'

// Overdue on Home: tasks still scheduled on an earlier day, oldest first, each with Reschedule
// (a block today or tomorrow, or back to the Backlog: a rollover) or Delete. Nothing if none.
export function OverdueCard({ today }: { today: ISODate }) {
  const tasks = useLiveQuery(
    async () => overdueTasks(await db.tasks.where('status').equals('scheduled').toArray(), today),
    [today],
  )
  const [moving, setMoving] = useState<Task | null>(null)
  const [deleting, setDeleting] = useState<ID | null>(null)
  if (!tasks?.length) return null

  return (
    <section aria-label="Overdue" className="rounded-xl bg-white p-4">
      <p className="font-semibold">Overdue · {tasks.length}</p>
      <ul className="divide-y divide-stone-100">
        {tasks.map((t) => (
          <li key={t.id} className="py-2">
            <p className="font-medium">{t.title}</p>
            <p className="text-sm text-stone-500">
              {capitalise(dayLabel(t.date!, today))} · {formatDuration(t.estimate)}
              {t.reason && ` · ${t.reason}`}
            </p>
            {deleting === t.id ? (
              <div className="mt-2 rounded-lg bg-red-50 p-2">
                <p className="text-sm text-red-900">
                  Delete “{t.title}”?{t.repeat && ' This ends the repeat: no next one is created.'}
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className={`${secondaryBtn} flex-1`} onClick={() => setDeleting(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-lg bg-red-700 px-4 font-medium text-white"
                    onClick={async () => {
                      await deleteTask(t.id)
                      setDeleting(null)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button type="button" className={`${secondaryBtn} flex-1`} onClick={() => setMoving(t)}>
                  Reschedule
                </button>
                <button type="button" className={dangerBtn} onClick={() => setDeleting(t.id)}>
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {moving && <MoveSheet task={moving} onClose={() => setMoving(null)} />}
    </section>
  )
}
