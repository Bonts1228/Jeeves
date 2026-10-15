import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Capture } from '../components/Capture'
import { DoneBanner, useDone } from '../components/DoneBanner'
import { BackIcon } from '../components/icons'
import { TaskSheet } from '../components/TaskSheet'
import { useUnfinishedPrompt } from '../components/UnfinishedSheet'
import { BlockGoalRow, TaskRow } from '../components/TaskRow'
import { secondaryBtn } from '../components/ui'
import { db } from '../db/db'
import { blockGoal, blockTasks, blockTicked, canQuickAdd, servedGoal, upNext, whenLabel } from '../lib/day'
import { isoDate } from '../lib/dates'
import { goalNumber } from '../lib/progress'
import { formatDuration } from '../lib/time'
import { useDay } from '../lib/use-day'
import { useNow } from '../lib/use-now'
import type { ID } from '../types'

// Focus block: the block and its time left, the goal it moves, the current task with Done, then the
// block's other tasks. Start block just opens this; nothing is timed or stored.
export function Focus() {
  const { id = '' } = useParams()
  const now = useNow()
  const block = useLiveQuery(async () => (await db.blocks.get(id)) ?? null, [id])
  const day = useDay(block?.date ?? isoDate(now))
  const [editing, setEditing] = useState<ID | null>(null)
  const [adding, setAdding] = useState(false)
  const { toggleTask, toggleBlock, details } = useDone()
  // This block's unfinished tasks, once it has ended (today only: earlier days are Overdue on Home)
  const today = isoDate(now)
  const unfinished = useUnfinishedPrompt(today, block?.date === today ? day : undefined, now, { auto: false, blockId: id })
  const groups = unfinished.groups

  if (block === null) return <Page title="Block not found" />
  if (!block || !day || day.blocks.every((b) => b.id !== block.id)) return <Page title="" />

  const title = day.areaName(block.areaId)
  const tasks = blockTasks(day.tasks, block, day)
  const open = tasks.filter((t) => t.status === 'scheduled')
  const [current, ...rest] = open
  const served = servedGoal(block, day.goals)
  const ticked = blockTicked(block, day.logs)
  const goal = blockGoal(block, current, day) // a served goal shows as the block's tick row instead
  const number = (goalId: ID) => goalNumber(day.goals.find((g) => g.id === goalId)!, day.pathTasks, day.logs, now)
  const finished = !current && (!served || ticked)
  const next = finished && block.date === isoDate(now) ? upNext({ ...day, date: block.date, now }) : undefined
  const left = open.reduce((sum, t) => sum + t.estimate, 0)

  return (
    <Page title={title}>
      <p className="text-sm text-stone-500">
        {block.start}–{block.end} · {block.protected ? 'Protected' : whenLabel(block, now)}
        {left > 0 && ` · ${formatDuration(left)} of tasks`}
      </p>
      {goal && goal !== served && (
        <Link to={`/goals/${goal.id}`} className="flex min-h-11 items-center rounded-xl bg-white px-4 active:bg-stone-50">
          <span className="min-w-0 flex-1 truncate font-medium">{goal.title}</span>
          <span className="text-sm text-stone-500">{number(goal.id)}</span>
        </Link>
      )}

      {groups.length > 0 && (
        <section className="flex items-center gap-3 rounded-xl bg-white p-4">
          <p className="flex-1 font-medium">Block ended · {unfinished.count} unfinished</p>
          <button type="button" className={secondaryBtn} onClick={unfinished.open}>
            Sort out
          </button>
        </section>
      )}

      {current && (
        <section aria-label="Current task" className="rounded-xl bg-white p-4">
          <button type="button" className="w-full text-left" onClick={() => setEditing(current.id)}>
            <p className="text-xl font-semibold">{current.title}</p>
            <p className="text-sm text-stone-500">
              {formatDuration(current.estimate)}
              {current.reason && ` · ${current.reason}`}
            </p>
          </button>
          <button
            type="button"
            className="mt-3 h-14 w-full rounded-lg bg-stone-900 text-lg font-medium text-white active:bg-stone-700"
            onClick={() => toggleTask(current)}
          >
            Done
          </button>
        </section>
      )}

      {finished && (
        <section className="rounded-xl bg-white p-4">
          <p className="text-xl font-semibold">{block.protected ? 'Protected: no tasks here' : 'Block done'}</p>
          {next?.kind === 'block' && next.block.id !== block.id && (
            <Link to={`/block/${next.block.id}`} className="mt-1 block text-stone-600 underline">
              Up next: {day.areaName(next.block.areaId)} {next.block.start}–{next.block.end}
            </Link>
          )}
        </section>
      )}

      {(served || rest.length > 0 || tasks.length > open.length) && (
        <ul className="divide-y divide-stone-100 rounded-xl bg-white px-4">
          {served && (
            <BlockGoalRow
              title={served.title}
              number={number(served.id)}
              ticked={ticked}
              onToggle={() => toggleBlock(block, served, ticked)}
            />
          )}
          {tasks
            .filter((t) => t !== current)
            .map((t) => (
              <TaskRow key={t.id} task={t} onToggle={() => toggleTask(t)} onOpen={() => setEditing(t.id)} />
            ))}
        </ul>
      )}
      {canQuickAdd(block, now) && (
        <button type="button" className={`${secondaryBtn} w-full`} onClick={() => setAdding(true)}>
          + Add to this block
        </button>
      )}
      <DoneBanner />
      {details.sheet}
      {editing && <TaskSheet taskId={editing} onClose={() => setEditing(null)} />}
      {adding && <Capture init={{ block }} onClose={() => setAdding(false)} />}
      {unfinished.sheet}
    </Page>
  )
}

function Page({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-md pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 flex items-center gap-1 bg-stone-50/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
        <Link
          to="/"
          aria-label="Back to Plan"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-600 active:bg-stone-200"
        >
          <BackIcon />
        </Link>
        <h1 className="min-w-0 flex-1 truncate py-3 text-2xl font-semibold">{title}</h1>
      </header>
      <main className="space-y-4 px-4 pt-1">{children}</main>
    </div>
  )
}
