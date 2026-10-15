import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDone } from '../components/DoneBanner'
import { TaskSheet } from '../components/TaskSheet'
import { BlockGoalRow, TaskRow } from '../components/TaskRow'
import { primaryBtn, secondaryBtn } from '../components/ui'
import { briefState } from '../db/brief'
import { db, SETTINGS_KEY } from '../db/db'
import { blockTasks, blockTicked, servedGoal, upNext, whenLabel } from '../lib/day'
import { addDays, isoDate } from '../lib/dates'
import { goalNumber } from '../lib/progress'
import { blockMinutes, formatDuration, minutesOfDay, toMinutes } from '../lib/time'
import { useDay } from '../lib/use-day'
import { useNow } from '../lib/use-now'
import type { ID, Weekday } from '../types'

// Home / day view: Up next, then today's blocks with their tasks, and the way into tomorrow's brief.
export function Plan() {
  const now = useNow()
  const today = isoDate(now)
  const weekday = now.getDay() as Weekday
  const day = useDay(today)
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_KEY))
  const tomorrow = addDays(today, 1)
  const brief = useLiveQuery(() => briefState(tomorrow), [tomorrow])
  const todayBrief = useLiveQuery(async () => (await briefState(today)) ?? null, [today])
  const [editing, setEditing] = useState<ID | null>(null)
  const { banner, toggleTask, toggleBlock } = useDone({ aboveBar: true })

  if (!day || !settings || todayBrief === undefined) return null
  const { areaName, goals, logs, tasks } = day

  const blocks = [...day.blocks].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  const blockTime = blocks.filter((b) => !b.protected).reduce((sum, b) => sum + blockMinutes(b), 0)
  const next = upNext({ ...day, date: today, now })
  const briefDue = minutesOfDay(now) >= toMinutes(settings.briefTime)
  const number = (goalId: ID) => goalNumber(goals.find((g) => g.id === goalId)!, day.pathTasks, logs, now)

  return (
    <div className="space-y-4">
      <section aria-label="Up next" className="rounded-xl bg-white p-4">
        {next.kind === 'block' && (
          <>
            <p className="text-sm text-stone-500">
              {next.current ? 'Now' : 'Up next'} · {areaName(next.block.areaId)} {next.block.start}–{next.block.end} ·{' '}
              {whenLabel(next.block, now)}
            </p>
            {next.task ? (
              <>
                <p className="mt-1 text-xl font-semibold">{next.task.title}</p>
                <p className="text-sm text-stone-500">
                  {formatDuration(next.task.estimate)}
                  {next.task.reason && ` · ${next.task.reason}`}
                </p>
              </>
            ) : (
              next.goal && (
                <>
                  <p className="mt-1 text-xl font-semibold">{next.goal.title}</p>
                  <p className="text-sm text-stone-500">{number(next.goal.id)}</p>
                </>
              )
            )}
            <div className="mt-3 flex gap-2">
              <Link to={`/block/${next.block.id}`} className={`${secondaryBtn} flex flex-1 items-center justify-center`}>
                Start block
              </Link>
              <button
                type="button"
                className={`${primaryBtn} flex-1`}
                onClick={() => (next.task ? toggleTask(next.task) : toggleBlock(next.block, next.goal!, false))}
              >
                Done
              </button>
            </div>
          </>
        )}
        {next.kind === 'leftovers' && (
          <>
            <p className="font-semibold">
              {next.tasks.length} task{next.tasks.length === 1 ? '' : 's'} left from earlier blocks
            </p>
            <ul className="divide-y divide-stone-100">
              {next.tasks.map((t) => (
                <TaskRow key={t.id} task={t} onToggle={() => toggleTask(t)} onOpen={() => setEditing(t.id)} />
              ))}
            </ul>
          </>
        )}
        {next.kind === 'done' && <p className="text-xl font-semibold">Today's done</p>}
        {next.kind === 'empty' && (
          <>
            <p className="text-xl font-semibold">Nothing planned today</p>
            {!todayBrief && (
              <Link to="/brief?date=today" className={`${primaryBtn} mt-3 flex items-center justify-center`}>
                Plan today
              </Link>
            )}
          </>
        )}
      </section>

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
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
        </p>
        <p className="text-sm text-stone-500">
          {formatDuration(settings.capacity[weekday])} capacity · {formatDuration(blockTime)} in blocks
        </p>
      </div>
      <ul className="space-y-3">
        {blocks.length === 0 && <li className="text-stone-500">No blocks today.</li>}
        {blocks.map((b) => {
          const header = (
            <>
              <span className="w-28 shrink-0 tabular-nums text-sm">
                {b.start}–{b.end}
              </span>
              <span className="flex-1 font-medium">{areaName(b.areaId)}</span>
              <span className="text-sm text-stone-500">{b.protected ? 'Protected' : whenLabel(b, now)}</span>
            </>
          )
          if (b.protected)
            return (
              <li key={b.id} className="flex min-h-14 items-center gap-3 rounded-xl bg-stone-100 px-4 py-3 text-stone-500">
                {header}
              </li>
            )
          const goal = servedGoal(b, goals)
          const ticked = blockTicked(b, logs)
          return (
            <li key={b.id} className="rounded-xl bg-white">
              <Link to={`/block/${b.id}`} className="flex min-h-14 items-center gap-3 rounded-xl px-4 active:bg-stone-50">
                {header}
              </Link>
              <ul className="divide-y divide-stone-100 px-4 pb-1">
                {goal && (
                  <BlockGoalRow
                    title={goal.title}
                    number={number(goal.id)}
                    ticked={ticked}
                    onToggle={() => toggleBlock(b, goal, ticked)}
                  />
                )}
                {blockTasks(tasks, b, day).map((t) => (
                  <TaskRow key={t.id} task={t} onToggle={() => toggleTask(t)} onOpen={() => setEditing(t.id)} />
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
      {banner}
      {editing && <TaskSheet taskId={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
