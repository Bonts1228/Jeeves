import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { deleteTask, type TaskPatch, uncompleteTask, updateTask } from '../db/tasks'
import { isoDate } from '../lib/dates'
import type { ID, Task } from '../types'
import { useDone } from './DoneBanner'
import { Sheet } from './Sheet'
import { dayLabel, type Fields, type Link, type Refs, resolve, useRefs } from '../lib/task-fields'
import { TaskFields } from './TaskFields'
import { dangerBtn, input, primaryBtn, secondaryBtn } from './ui'

// Edit a task: same chips as Capture, plus Mark done / Undo done and Delete (with confirm).
// Mark done asks for the goal's details first, in place of the form.
export function TaskSheet({ taskId, onClose }: { taskId: ID; onClose: () => void }) {
  const task = useLiveQuery(() => db.tasks.get(taskId), [taskId])
  const refs = useRefs()
  const [today] = useState(() => isoDate(new Date()))
  const { doneTask, details } = useDone()
  if (!task || !refs) return null

  if (details.asking)
    return (
      <Sheet title={`${details.asking.title} · details`} onClose={details.cancel}>
        {details.form}
      </Sheet>
    )

  return (
    <Sheet title={task.status === 'done' ? 'Done' : 'Edit task'} onClose={onClose}>
      {task.status === 'done' ? (
        <DoneView task={task} today={today} onClose={onClose} />
      ) : (
        <EditForm task={task} refs={refs} today={today} onClose={onClose} onDone={() => doneTask(task)} />
      )}
    </Sheet>
  )
}

const linkOf = (t: Task): Link => (t.projectId ? { projectId: t.projectId } : t.goalId ? { goalId: t.goalId } : null)

function EditForm({
  task,
  refs,
  today,
  onClose,
  onDone,
}: {
  task: Task
  refs: Refs
  today: string
  onClose: () => void
  onDone: () => void
}) {
  const [title, setTitle] = useState(task.title)
  const [fields, setFields] = useState<Fields>(() => ({
    estimate: task.estimate,
    areaId: task.areaId,
    link: linkOf(task),
    due: task.due,
    repeat: task.repeat,
    schedule: task.status === 'scheduled' ? { date: task.date!, placement: { blockId: task.blockId! } } : null,
  }))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { project, goal, estimate, areaId } = resolve(fields, refs)
  const { schedule } = fields
  const scheduleIncomplete = !!schedule && !schedule.placement
  const valid = !!title.trim() && !!areaId && !scheduleIncomplete

  const save = async () => {
    if (!valid) return
    const patch: TaskPatch = { title: title.trim(), estimate, areaId, due: fields.due, repeat: fields.repeat }
    // Moved to another goal/project: updateTask puts it last there
    if (JSON.stringify(fields.link) !== JSON.stringify(linkOf(task))) Object.assign(patch, { goalId: goal?.id, projectId: project?.id })
    const placement = schedule?.placement
    const result = await updateTask(
      task.id,
      patch,
      placement ? { date: schedule.date, placement } : task.status === 'scheduled' ? null : undefined,
    )
    if (result === 'no-room') {
      setError("That doesn't fit any more. Pick a block again or make a new one.")
      setFields((f) => ({ ...f, schedule: f.schedule && { date: f.schedule.date, placement: null } }))
    } else onClose()
  }

  if (confirmDelete)
    return (
      <div className="space-y-3 rounded-xl bg-red-50 p-3">
        <p className="text-red-900">
          Delete “{task.title}”?
          {task.repeat && <span className="block text-sm">This ends the repeat: no next one is created.</span>}
        </p>
        <div className="flex gap-2">
          <button type="button" className={`${secondaryBtn} flex-1`} onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="h-11 flex-1 rounded-lg bg-red-700 px-4 font-medium text-white"
            onClick={async () => {
              await deleteTask(task.id)
              onClose()
            }}
          >
            Delete
          </button>
        </div>
      </div>
    )

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <label htmlFor="task-title" className="sr-only">
        Title
      </label>
      <input
        id="task-title"
        autoComplete="off"
        enterKeyHint="done"
        className={`${input} w-full`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <TaskFields
        fields={fields}
        onChange={(f) => {
          setFields(f)
          setError(null)
        }}
        refs={refs}
        today={today}
        task={task}
      />
      {task.reason && <p className="text-sm text-stone-500">{task.reason}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        className={`${secondaryBtn} w-full`}
        onClick={onDone}
      >
        Mark done
      </button>
      <div className="flex gap-2 pt-1">
        <button type="button" className={dangerBtn} onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
        <button type="button" className={`${secondaryBtn} ml-auto`} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={primaryBtn} disabled={!valid}>
          Save
        </button>
      </div>
    </form>
  )
}

// A ticked task: show what happens next and offer Undo.
function DoneView({ task, today, onClose }: { task: Task; today: string; onClose: () => void }) {
  const next = useLiveQuery(() => db.tasks.where('prevId').equals(task.id).first(), [task.id])
  return (
    <div className="space-y-3">
      <p className="font-medium">✓ {task.title}</p>
      {next && next.status !== 'deleted' && next.due && (
        <p className="text-sm text-stone-500">Next one is due {dayLabel(next.due, today)}.</p>
      )}
      <div className="flex gap-2">
        <button type="button" className={`${secondaryBtn} flex-1`} onClick={() => uncompleteTask(task.id)}>
          Undo done
        </button>
        <button type="button" className={`${primaryBtn} flex-1`} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
