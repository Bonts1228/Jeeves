import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BackIcon } from '../components/icons'
import { Sheet } from '../components/Sheet'
import { SchedulePicker } from '../components/TaskFields'
import { input, primaryBtn, secondaryBtn } from '../components/ui'
import { ensureBlocks } from '../db/blocks'
import { addToBrief, briefState, confirmBrief, fillBrief, readBrief, removeFromBrief } from '../db/brief'
import { db } from '../db/db'
import { addDays, isoDate, parseISODate } from '../lib/dates'
import { type ScheduleDraft, taskFacts } from '../lib/task-fields'
import { blockMinutes, formatDuration, toMinutes } from '../lib/time'
import type { Area, ID, ISODate, Task } from '../types'

// Brief review: tomorrow's tasks by block, a reason under each, remove (×), add from the Backlog,
// Confirm. The first visit builds the brief; Refill adds what fits in the room left.
// ?date=today plans today instead (Home's "Plan today" on a day with no brief), from now on.
export function Brief() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [now] = useState(() => new Date())
  const today = isoDate(now)
  const forToday = params.get('date') === 'today'
  const date = forToday ? today : addDays(today, 1)
  const [ready, setReady] = useState(false)
  const [adding, setAdding] = useState<Task | 'pick' | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      if (await briefState(date)) await ensureBlocks(date)
      else await fillBrief(date, { now })
      if (live) setReady(true)
    })()
    return () => {
      live = false
    }
  }, [date, now])

  const areas = useLiveQuery(() => db.areas.toArray())
  const blocks = useLiveQuery(() => db.blocks.where('date').equals(date).toArray(), [date])
  const tasks = useLiveQuery(
    () => db.tasks.where('date').equals(date).filter((t) => t.status === 'scheduled').toArray(),
    [date],
  )
  const brief = useLiveQuery(() => (ready ? readBrief(date, { now }) : undefined), [ready, date, now])
  const state = useLiveQuery(() => briefState(date), [date])

  const title = parseISODate(date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
  if (!ready || !areas || !blocks || !tasks || !brief)
    return <Page title={title} />

  const used = tasks.reduce((sum, t) => sum + t.estimate, 0)
  const over = used - brief.cap
  const areaName = (id: ID) => areas.find((a) => a.id === id)?.name ?? 'Area'
  const sorted = [...blocks].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))

  return (
    <Page title={title}>
      <p className="text-sm text-stone-500">
        {formatDuration(used)} of {formatDuration(brief.cap)}
        {over > 0 && <span className="text-stone-900"> · {over} min over</span>}
        {state?.confirmedAt && ' · Confirmed'}
      </p>

      <ul className="space-y-3">
        {sorted.length === 0 && <li className="text-stone-500">No blocks {forToday ? 'today' : 'tomorrow'}.</li>}
        {sorted.map((b) => {
          const inBlock = tasks.filter((t) => t.blockId === b.id)
          const free = blockMinutes(b) - inBlock.reduce((sum, t) => sum + t.estimate, 0)
          return (
            <li key={b.id} className={`rounded-xl ${b.protected ? 'bg-stone-100 text-stone-500' : 'bg-white'}`}>
              <div className="flex min-h-11 items-center gap-3 px-4 pt-2">
                <span className="tabular-nums text-sm">
                  {b.start}–{b.end}
                </span>
                <span className="flex-1 font-medium">{areaName(b.areaId)}</span>
                <span className="text-sm text-stone-500">
                  {b.protected ? 'Protected' : free > 0 ? `${formatDuration(free)} free` : 'Full'}
                </span>
              </div>
              <ul className="divide-y divide-stone-100 px-4 pb-2">
                {inBlock.map((t) => (
                  <li key={t.id} className="flex min-h-14 items-center gap-2 py-1">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t.title}</p>
                      <p className="text-sm text-stone-500">
                        {formatDuration(t.estimate)} · {t.reason ?? 'Added by you'}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${t.title}`}
                      onClick={() => removeFromBrief(date, t.id)}
                      className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-stone-400 active:bg-stone-100"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>

      {brief.notPlaced.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase">Not placed</h2>
          <ul className="divide-y divide-stone-100 rounded-xl bg-white">
            {brief.notPlaced.map(({ task, reason, why }) => (
              <li key={task.id} className="flex min-h-14 items-center gap-2 px-4 py-1">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{task.title}</p>
                  <p className="text-sm text-stone-500">
                    {formatDuration(task.estimate)} · {reason} · {why}
                  </p>
                </div>
                <button type="button" className={secondaryBtn} onClick={() => setAdding(task)}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-2">
        <button type="button" className={`${secondaryBtn} flex-1`} onClick={() => setAdding('pick')}>
          + Add from Backlog
        </button>
        <button type="button" className={secondaryBtn} onClick={() => fillBrief(date)}>
          Refill
        </button>
      </div>
      <button
        type="button"
        className={`${primaryBtn} w-full`}
        onClick={async () => {
          await confirmBrief(date)
          navigate('/')
        }}
      >
        Confirm brief
      </button>

      {adding && (
        <AddSheet
          date={date}
          today={today}
          areas={areas}
          task={adding === 'pick' ? undefined : adding}
          onClose={() => setAdding(null)}
        />
      )}
    </Page>
  )
}

function Page({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-md pb-[calc(2rem+env(safe-area-inset-bottom))]">
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

// + Add from Backlog: pick a task (unless one was given), then a block with room or a new one-off
// block on the brief's date. Manual-only tasks may use any area's block.
function AddSheet({
  date,
  today,
  areas,
  task: given,
  onClose,
}: {
  date: ISODate
  today: ISODate
  areas: Area[]
  task?: Task
  onClose: () => void
}) {
  const [task, setTask] = useState<Task | undefined>(given)
  const [query, setQuery] = useState('')
  const [schedule, setSchedule] = useState<ScheduleDraft>({ date, placement: null })
  const [error, setError] = useState<string | null>(null)
  const projects = useLiveQuery(() => db.projects.toArray())
  // The Backlog, plus anything left scheduled on an earlier day
  const open = useLiveQuery(
    async () =>
      (await db.tasks.where('status').anyOf('backlog', 'scheduled').toArray())
        .filter((t) => t.status === 'backlog' || t.date! < date)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [date],
  )
  if (!projects || !open) return null

  const anyArea = !!projects.find((p) => p.id === task?.projectId)?.manualOnly
  const q = query.trim().toLowerCase()

  const add = async () => {
    if (!task || !schedule.placement) return
    if (await addToBrief(date, task.id, schedule.placement)) onClose()
    else {
      setError("That doesn't fit any more. Pick again.")
      setSchedule({ date, placement: null })
    }
  }

  return (
    <Sheet title={task ? task.title : 'Add from Backlog'} onClose={onClose}>
      {!task ? (
        <div className="space-y-3">
          <label className="block">
            <span className="sr-only">Find a task</span>
            <input
              className={`${input} w-full`}
              placeholder="Find a task"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </label>
          <ul className="divide-y divide-stone-100">
            {open
              .filter((t) => !q || t.title.toLowerCase().includes(q))
              .map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="flex min-h-14 w-full flex-col justify-center py-2 text-left active:bg-stone-50"
                    onClick={() => setTask(t)}
                  >
                    <span className="font-medium">{t.title}</span>
                    <span className="text-sm text-stone-500">{taskFacts(t, today)}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-stone-500">{taskFacts(task, today)}</p>
          <SchedulePicker
            schedule={schedule}
            estimate={task.estimate}
            areaId={task.areaId}
            anyArea={anyArea}
            areas={areas}
            today={today}
            task={task}
            dates={[date]}
            onChange={(s) => {
              setError(null)
              setSchedule(s ?? { date, placement: null })
            }}
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className={`${secondaryBtn} ml-auto`} onClick={given ? onClose : () => setTask(undefined)}>
              {given ? 'Cancel' : 'Back'}
            </button>
            <button type="button" className={primaryBtn} disabled={!schedule.placement} onClick={add}>
              Add
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
