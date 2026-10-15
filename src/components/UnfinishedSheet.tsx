import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { ensureBlocks } from '../db/blocks'
import {
  dismissedUnfinished,
  dismissUnfinished,
  moveSession,
  readNextBlocks,
  readNextSessions,
  rollOver,
  skipBlockGoal,
} from '../db/unfinished'
import { addDays, isoDate, weekdayOf } from '../lib/dates'
import { useRefs } from '../lib/task-fields'
import { formatDuration, WEEKDAY_SHORT } from '../lib/time'
import { blockEndAt, promptIds, type UnfinishedGroup, unfinishedGroups } from '../lib/unfinished'
import type { Block, Goal, ID, ISODate, LogEntry, Task } from '../types'
import { DayBlocksSheet } from './DayBlocksSheet'
import { useDone } from './DoneBanner'
import { MoveForm } from './MoveSheet'
import { anySheetOpen, Sheet } from './Sheet'
import { secondaryBtn } from './ui'

// Unfinished at block end: one sheet for every ended (or deleted) block with open tasks, a card per
// task with Next block / Pick a block / Back to Backlog. Each counts a rollover. Did it ticks the task
// as of the block's end, no rollover (details first if its goal records them). An ended block whose
// goal is unticked asks "did you train?": Done ticks it as of the block's end, Skipped drops it, Move
// session drops it for a later block (or a new one) that asks in turn. Closing it (Later,
// backdrop, Escape) leaves the tasks as they are; the caller remembers them as dismissed.
export function UnfinishedSheet({
  groups,
  now,
  onClose,
}: {
  groups: UnfinishedGroup[]
  now: Date
  onClose: () => void
}) {
  const refs = useRefs()
  const today = isoDate(now)
  const tomorrow = addDays(today, 1)
  const [ready, setReady] = useState(false)
  const [picking, setPicking] = useState<Task | null>(null)
  const [newSession, setNewSession] = useState<Block | null>(null) // the ended goal block a new block is for
  const [errors, setErrors] = useState<Record<ID, string>>({})
  const { doneTask, tickGoalBlock, details } = useDone()
  const tasks = groups.flatMap((g) => g.tasks)
  const goalBlocks = groups.flatMap((g) => (g.goal && g.block ? [g.block] : []))
  const ids = [...tasks, ...goalBlocks].map((x) => x.id).join()

  useEffect(() => {
    let live = true
    ensureBlocks(tomorrow).then(() => live && setReady(true))
    return () => {
      live = false
    }
  }, [tomorrow])
  // Re-reads when any task, block or log changes, so each card's destination stays true
  const dests = useLiveQuery(
    async () =>
      ready
        ? { next: await readNextBlocks(tasks, { now }), sessions: await readNextSessions(goalBlocks, { now }) }
        : undefined,
    [ready, ids, now],
  )
  if (!refs || !dests) return null
  const { next, sessions } = dests

  const areaName = (id: ID) => refs.areas.find((a) => a.id === id)?.name ?? 'Area'
  const manual = (t: Task) => !!refs.projects.find((p) => p.id === t.projectId)?.manualOnly
  const where = (b: Block) => (b.date === today ? b.start : `${WEEKDAY_SHORT[weekdayOf(b.date)]} ${b.start}`)

  if (details.asking)
    return (
      <Sheet title={`${details.asking.title} · details`} onClose={details.cancel}>
        {details.form}
      </Sheet>
    )

  if (newSession)
    return (
      <DayBlocksSheet
        date={today}
        areaId={newSession.areaId}
        onAdded={() => {
          void moveSession(newSession.date, newSession.id)
          setNewSession(null)
        }}
        onClose={() => setNewSession(null)}
      />
    )

  if (picking)
    return (
      <Sheet title={picking.title} onClose={() => setPicking(null)}>
        <MoveForm task={picking} onDone={() => setPicking(null)} onCancel={() => setPicking(null)} />
      </Sheet>
    )

  const move = async (task: Task, block: Block | null) => {
    const ok = await rollOver(task.id, block && { date: block.date, placement: { blockId: block.id } })
    if (!ok) setErrors((e) => ({ ...e, [task.id]: "That doesn't fit any more. Pick a block." }))
  }

  return (
    <Sheet title="Unfinished" onClose={onClose}>
      <div className="space-y-4">
        {groups.map((g) => (
          <section key={g.block?.id ?? 'deleted'}>
            <h3 className="mb-2 text-sm font-semibold text-stone-500">
              {g.block ? `${areaName(g.block.areaId)} ${g.block.start}–${g.block.end} · ended` : 'Deleted block'}
            </h3>
            <ul className="space-y-2">
              {g.goal && g.block && (
                <GoalCard
                  goal={g.goal}
                  block={g.block}
                  to={sessions.get(g.block.id) ?? null}
                  where={where}
                  areaName={areaName(g.block.areaId)}
                  onNewBlock={() => setNewSession(g.block!)}
                  onDone={() => tickGoalBlock(g.block!, g.goal!, { now: blockEndAt(g.block!) })}
                />
              )}
              {g.tasks.map((t) => {
                const dest = next.get(t.id)
                return (
                  <li key={t.id} className="rounded-xl bg-stone-100 p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{t.title}</p>
                        <p className="text-sm text-stone-500">
                          {formatDuration(t.estimate)}
                          {t.reason && ` · ${t.reason}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`${secondaryBtn} shrink-0 px-3 text-sm`}
                        onClick={() => doneTask(t, { now: g.block ? blockEndAt(g.block) : now })}
                      >
                        Did it
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        className={`${secondaryBtn} flex h-auto min-h-11 flex-col items-center justify-center px-1 text-sm leading-tight`}
                        disabled={!dest}
                        onClick={() => dest && move(t, dest)}
                      >
                        Next block
                        {dest && <span className="text-xs font-normal text-stone-500">{where(dest)}</span>}
                      </button>
                      <button type="button" className={`${secondaryBtn} px-1 text-sm`} onClick={() => setPicking(t)}>
                        Pick a block
                      </button>
                      <button type="button" className={`${secondaryBtn} px-1 text-sm`} onClick={() => move(t, null)}>
                        Backlog
                      </button>
                    </div>
                    {!dest && (
                      <p className="mt-1 text-xs text-stone-500">
                        No {manual(t) ? '' : `${areaName(t.areaId)} `}block with {formatDuration(t.estimate)} free today or
                        tomorrow
                      </p>
                    )}
                    {errors[t.id] && (
                      <p role="alert" className="mt-1 text-sm text-red-700">
                        {errors[t.id]}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
        <button type="button" className={`${secondaryBtn} w-full`} onClick={onClose}>
          Later
        </button>
      </div>
    </Sheet>
  )
}

// A block goal left unticked: Done (logged as of the block's end, details first), Skipped, or Move session to the
// next same-area block (to) or a new one. Moving logs nothing: the goal counts when a block is ticked.
function GoalCard({
  goal,
  block,
  to,
  where,
  areaName,
  onNewBlock,
  onDone,
}: {
  goal: Goal
  block: Block
  to: Block | null
  where: (b: Block) => string
  areaName: string
  onNewBlock: () => void
  onDone: () => void
}) {
  const [moving, setMoving] = useState(false)
  return (
    <li className="rounded-xl bg-stone-100 p-3">
      <p className="font-medium">{goal.title} · did you train?</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button type="button" className={`${secondaryBtn} px-1 text-sm`} onClick={onDone}>
          Done
        </button>
        <button type="button" className={`${secondaryBtn} px-1 text-sm`} onClick={() => skipBlockGoal(block.date, block.id)}>
          Skipped
        </button>
        <button
          type="button"
          aria-expanded={moving}
          className={`${secondaryBtn} px-1 text-sm`}
          onClick={() => setMoving((m) => !m)}
        >
          Move session
        </button>
      </div>
      {moving && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`${secondaryBtn} flex h-auto min-h-11 flex-col items-center justify-center px-1 text-sm leading-tight`}
            disabled={!to}
            onClick={() => to && moveSession(block.date, block.id)}
          >
            {to ? `To ${where(to)}` : 'No later block'}
            {!to && <span className="text-xs font-normal text-stone-500">No {areaName} block today or tomorrow</span>}
          </button>
          <button type="button" className={`${secondaryBtn} px-1 text-sm`} onClick={onNewBlock}>
            New block
          </button>
        </div>
      )}
    </li>
  )
}

export interface PromptDay {
  tasks: Task[] // the date's tasks
  blocks: Block[] // the date's blocks
  goals: Goal[]
  logs: LogEntry[]
}

// The Unfinished prompt for a date (blockId: just that block). auto: open by itself whenever something
// is unfinished that the prompt wasn't closed on before, once no other sheet is showing (checked again
// as now ticks). Closing without a choice remembers what was shown, so it only comes back for new ones.
export function useUnfinishedPrompt(
  date: ISODate,
  day: PromptDay | undefined,
  now: Date,
  { auto, blockId }: { auto: boolean; blockId?: ID },
) {
  const dismissed = useLiveQuery(() => dismissedUnfinished(date), [date])
  const [shown, setShown] = useState(false)
  const groups =
    day && dismissed
      ? unfinishedGroups(date, day.tasks, day.blocks, now, { goals: day.goals, logs: day.logs, dismissed }).filter(
          (g) => !blockId || g.block?.id === blockId,
        )
      : []
  const ids = promptIds(groups)
  const fresh = !!dismissed && ids.some((id) => !dismissed.includes(id))

  useEffect(() => {
    if (auto && fresh && !shown && !anySheetOpen()) setShown(true)
  }, [auto, fresh, shown, now])
  useEffect(() => {
    if (!groups.length) setShown(false)
  }, [groups.length])

  const close = () => {
    setShown(false)
    if (ids.length) void dismissUnfinished(date, ids)
  }
  const sheet = shown && groups.length > 0 && <UnfinishedSheet groups={groups} now={now} onClose={close} />
  return { groups, count: ids.length, dismissed, open: () => setShown(true), sheet }
}
