import { useState } from 'react'
import { updateTask } from '../db/tasks'
import { rollOver } from '../db/unfinished'
import { addDays, isoDate } from '../lib/dates'
import { type ScheduleDraft, taskFacts, useRefs } from '../lib/task-fields'
import type { Task } from '../types'
import { Sheet } from './Sheet'
import { SchedulePicker } from './TaskFields'
import { primaryBtn, secondaryBtn } from './ui'

// Move an unfinished or overdue task on: a block with room today or tomorrow (or a new one-off
// block), or back to the Backlog. Either way counts a rollover. onDone runs after a move.
export function MoveForm({ task, onDone, onCancel }: { task: Task; onDone: () => void; onCancel: () => void }) {
  const refs = useRefs()
  const [today] = useState(() => isoDate(new Date()))
  const [schedule, setSchedule] = useState<ScheduleDraft>({ date: today, placement: null })
  const [error, setError] = useState<string | null>(null)
  if (!refs) return null
  const anyArea = !!refs.projects.find((p) => p.id === task.projectId)?.manualOnly

  const move = async (to: ScheduleDraft | null) => {
    const ok = await rollOver(task.id, to?.placement ? { date: to.date, placement: to.placement } : null)
    if (ok) return onDone()
    setError("That doesn't fit any more. Pick again.")
    setSchedule({ date: schedule.date, placement: null })
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-500">{taskFacts(task, today)}</p>
      <SchedulePicker
        schedule={schedule}
        estimate={task.estimate}
        areaId={task.areaId}
        anyArea={anyArea}
        areas={refs.areas}
        today={today}
        task={task}
        dates={[today, addDays(today, 1)]}
        onChange={(s) => {
          setError(null)
          setSchedule(s ?? { date: today, placement: null })
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className={secondaryBtn} onClick={() => move(null)}>
          Back to Backlog
        </button>
        <button type="button" className={`${secondaryBtn} ml-auto`} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={primaryBtn} disabled={!schedule.placement} onClick={() => move(schedule)}>
          Move
        </button>
      </div>
    </div>
  )
}

export function MoveSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  return (
    <Sheet title={task.title} onClose={onClose}>
      <MoveForm task={task} onDone={onClose} onCancel={onClose} />
    </Sheet>
  )
}

// Schedule a Backlog task into a block with room today or tomorrow (or a new one-off block), no
// rollover: an urgent capture that fit nowhere today. onDone gets the day it went to.
export function ScheduleForm({ task, onDone, onCancel }: { task: Task; onDone: (date: string) => void; onCancel: () => void }) {
  const refs = useRefs()
  const [today] = useState(() => isoDate(new Date()))
  const [schedule, setSchedule] = useState<ScheduleDraft>({ date: today, placement: null })
  const [error, setError] = useState<string | null>(null)
  if (!refs) return null
  const anyArea = !!refs.projects.find((p) => p.id === task.projectId)?.manualOnly

  const save = async () => {
    if (!schedule.placement) return
    const result = await updateTask(task.id, {}, { date: schedule.date, placement: schedule.placement })
    if (result === 'ok') return onDone(schedule.date)
    setError("That doesn't fit any more. Pick again.")
    setSchedule({ date: schedule.date, placement: null })
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-500">{taskFacts(task, today)}</p>
      <SchedulePicker
        schedule={schedule}
        estimate={task.estimate}
        areaId={task.areaId}
        anyArea={anyArea}
        areas={refs.areas}
        today={today}
        task={task}
        dates={[today, addDays(today, 1)]}
        onChange={(s) => {
          setError(null)
          setSchedule(s ?? { date: today, placement: null })
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className={`${secondaryBtn} ml-auto`} onClick={onCancel}>
          Keep in Backlog
        </button>
        <button type="button" className={primaryBtn} disabled={!schedule.placement} onClick={save}>
          Schedule
        </button>
      </div>
    </div>
  )
}
