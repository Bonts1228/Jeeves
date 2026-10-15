import { useState } from 'react'
import { scheduleNewTask } from '../db/blocks'
import { db, newId } from '../db/db'
import { addTask } from '../db/tasks'
import { isoDate } from '../lib/dates'
import type { ID, Task } from '../types'
import { Sheet } from './Sheet'
import { dayLabel, emptyFields, type Fields, type Link, resolve, useRefs } from '../lib/task-fields'
import { TaskFields } from './TaskFields'
import { input, primaryBtn, secondaryBtn } from './ui'

export interface CaptureInit {
  text?: string
  link?: Link
  inboxId?: ID // turning an Inbox item into a task: it's removed in the same transaction as the save
}

// Quick capture. Fastest path: type, then To Inbox (or Enter) — no chips needed.
// Once any chip is set, Enter adds to the Backlog instead. The sheet stays open for the next task,
// except when processing an Inbox item, which closes it after the save.
export function Capture({ init, onClose }: { init?: CaptureInit; onClose: () => void }) {
  const refs = useRefs()
  const [text, setText] = useState(init?.text ?? '')
  const [fields, setFields] = useState<Fields>(() => emptyFields(init?.link ?? null))
  const [saves, setSaves] = useState(0) // remounts the chips (closing any open panel) after each save
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [today] = useState(() => isoDate(new Date()))

  if (!refs) return null

  const fromInbox = !!init?.inboxId
  const { project, goal, estimate, areaId } = resolve(fields, refs)
  const { link, due, repeat, schedule } = fields
  const touched =
    fromInbox || fields.estimate !== null || fields.areaId !== null || (link !== null && !init?.link) || !!due || !!repeat || !!schedule
  const scheduleIncomplete = !!schedule && !schedule.placement
  const title = text.trim()

  const saved = (message: string) => {
    if (fromInbox) return onClose()
    setText('')
    setFields((f) => ({ ...emptyFields(f.link), areaId: f.areaId })) // keep area and goal/project for the next one
    setSaves((n) => n + 1)
    setStatus({ ok: true, text: message })
  }

  const toInbox = async () => {
    if (!title) return
    await db.inbox.add({ id: newId(), text: title, createdAt: nowISO() })
    saved(`To Inbox: ${title}`)
  }

  const addToBacklog = async () => {
    if (!title || !areaId || scheduleIncomplete) return
    const task: Task = {
      id: newId(),
      title,
      estimate,
      areaId,
      ...(goal && { goalId: goal.id }),
      ...(project && { projectId: project.id }),
      ...(due && { due }),
      ...(repeat && { repeat }),
      status: 'backlog',
      rollovers: 0,
      delegable: false,
      createdAt: nowISO(),
    }
    if (schedule?.placement) {
      const placed = await scheduleNewTask(task, schedule.date, schedule.placement, { inboxId: init?.inboxId })
      if (!placed) {
        setStatus({ ok: false, text: 'That block no longer has room. Pick again.' })
        setFields((f) => ({ ...f, schedule: { date: schedule.date, placement: null } }))
        return
      }
      saved(`Scheduled ${dayLabel(schedule.date, today)}: ${title}`)
    } else {
      await addTask(task, { inboxId: init?.inboxId })
      saved(`To Backlog: ${title}`)
    }
  }

  return (
    <Sheet title={fromInbox ? 'Inbox item → task' : 'Capture'} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (touched) addToBacklog()
          else toInbox()
        }}
      >
        <label htmlFor="capture-text" className="sr-only">
          Task
        </label>
        <input
          id="capture-text"
          autoFocus
          autoComplete="off"
          enterKeyHint="done"
          className={`${input} w-full`}
          placeholder="What needs doing?"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setStatus(null)
          }}
        />

        <TaskFields key={saves} fields={fields} onChange={setFields} refs={refs} today={today} />

        {status && (
          <p role="status" className={`text-sm ${status.ok ? 'text-stone-500' : 'text-red-700'}`}>
            {status.text}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          {!fromInbox && (
            <button
              type="button"
              className={`${touched ? secondaryBtn : primaryBtn} flex-1`}
              disabled={!title}
              onClick={toInbox}
            >
              To Inbox
            </button>
          )}
          <button
            type="button"
            className={`${touched ? primaryBtn : secondaryBtn} flex-1`}
            disabled={!title || scheduleIncomplete}
            onClick={addToBacklog}
          >
            {schedule ? 'Schedule' : 'Add to Backlog'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

const nowISO = () => new Date().toISOString()
