import { formatDuration } from '../lib/time'
import type { Task } from '../types'

// Rows shared by Home and the Focus block: a task or a block goal, each with a Done tick.

function Tick({ done, label, onClick }: { done: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={done ? `Undo done: ${label}` : `Done: ${label}`}
      aria-pressed={done}
      onClick={onClick}
      className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-stone-100"
    >
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-sm ${
          done ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300'
        }`}
      >
        {done && '✓'}
      </span>
    </button>
  )
}

// A task with its tick; tapping the title opens it.
export function TaskRow({ task, onToggle, onOpen }: { task: Task; onToggle: () => void; onOpen: () => void }) {
  const done = task.status === 'done'
  return (
    <li className="flex min-h-14 items-center gap-1 py-1">
      <Tick done={done} label={task.title} onClick={onToggle} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-1 text-left">
        <p className={`font-medium ${done ? 'text-stone-400 line-through' : ''}`}>{task.title}</p>
        <p className="text-sm text-stone-500">
          {formatDuration(task.estimate)}
          {task.reason && ` · ${task.reason}`}
        </p>
      </button>
    </li>
  )
}

// The Done tick of a block that serves a goal ("Lifting · 2 of 5 this week").
export function BlockGoalRow({
  title,
  number,
  ticked,
  onToggle,
}: {
  title: string
  number: string
  ticked: boolean
  onToggle: () => void
}) {
  return (
    <li className="flex min-h-14 items-center gap-1 py-1">
      <Tick done={ticked} label={title} onClick={onToggle} />
      <div className="min-w-0 flex-1">
        <p className={`font-medium ${ticked ? 'text-stone-400 line-through' : ''}`}>{title}</p>
        <p className="text-sm text-stone-500">{number}</p>
      </div>
    </li>
  )
}
