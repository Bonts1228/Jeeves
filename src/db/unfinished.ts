import { isAnyAreaTask } from '../lib/brief'
import { addDays, isoDate } from '../lib/dates'
import { movedId, nextBlockFor, nextSessionFor, skippedId } from '../lib/unfinished'
import type { Block, ID, ISODate, Task } from '../types'
import { ensureBlocks, type Schedule } from './blocks'
import { type BriefDB, db as defaultDb } from './db'
import { updateTask } from './tasks'

// Unfinished at block end and overdue (M5): every way on counts a rollover. What the prompt was
// dismissed for lives in meta under unfinished:<date>, on this device only.

// Move an open scheduled task on: into a block (schedule) or back to the Backlog (null), counting a
// rollover. Back to Backlog clears date, blockId and reason. Returns false (nothing written) if the
// task isn't scheduled any more or the block no longer has room.
export async function rollOver(
  taskId: ID,
  schedule: Schedule | null,
  { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {},
): Promise<boolean> {
  if (schedule) await ensureBlocks(schedule.date, db)
  return db.transaction('rw', [db.tasks, db.blocks, db.blockTemplates, db.meta, db.goals, db.projects], async () => {
    const before = await db.tasks.get(taskId)
    if (before?.status !== 'scheduled') return false
    if ((await updateTask(taskId, {}, schedule, { now, db })) !== 'ok') return false
    await db.tasks.update(taskId, { rollovers: before.rollovers + 1 })
    return true
  })
}

// Where Next block would put each task: its area's first block with room today, else tomorrow
// (lib/unfinished). Read-only, so it can run in a live query; tomorrow's blocks must already exist.
export async function readNextBlocks(
  tasks: Task[],
  { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {},
): Promise<Map<ID, Block | null>> {
  const today = isoDate(now)
  const tomorrow = addDays(today, 1)
  const [todayBlocks, tomorrowBlocks, scheduled, projects] = await Promise.all([
    db.blocks.where('date').equals(today).toArray(),
    db.blocks.where('date').equals(tomorrow).toArray(),
    db.tasks.where('date').anyOf(today, tomorrow).filter((t) => t.status === 'scheduled').toArray(),
    db.projects.toArray(),
  ])
  return new Map(
    tasks.map((task) => [
      task.id,
      nextBlockFor({
        task,
        anyArea: isAnyAreaTask(task, projects),
        now,
        today: todayBlocks,
        tomorrow: tomorrowBlocks,
        scheduled,
      }),
    ]),
  )
}

const key = (date: ISODate) => `unfinished:${date}`

// Unfinished tasks the prompt was closed on without a choice: it doesn't reopen for them.
export async function dismissedUnfinished(date: ISODate, db: BriefDB = defaultDb): Promise<ID[]> {
  const raw = await db.meta.get(key(date))
  return raw ? JSON.parse(raw) : []
}

export async function dismissUnfinished(date: ISODate, ids: ID[], db: BriefDB = defaultDb) {
  await db.transaction('rw', db.meta, async () => {
    const all = [...new Set([...(await dismissedUnfinished(date, db)), ...ids])]
    await db.meta.put(JSON.stringify(all), key(date))
  })
}

// Skipped at a block goal's "did you train?": nothing is logged, and it isn't asked again.
export const skipBlockGoal = (date: ISODate, blockId: ID, db: BriefDB = defaultDb) =>
  dismissUnfinished(date, [skippedId(blockId)], db)

// Where "Move session" would go for each ended goal block (lib/unfinished). Read-only, like
// readNextBlocks; tomorrow's blocks must already exist.
export async function readNextSessions(
  blocks: Block[],
  { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {},
): Promise<Map<ID, Block | null>> {
  const today = isoDate(now)
  const [todayBlocks, tomorrowBlocks, logs] = await Promise.all([
    db.blocks.where('date').equals(today).toArray(),
    db.blocks.where('date').equals(addDays(today, 1)).toArray(),
    db.logEntries.where('blockId').above('').toArray(),
  ])
  return new Map(
    blocks.map((block) => [block.id, nextSessionFor({ block, now, today: todayBlocks, tomorrow: tomorrowBlocks, logs })]),
  )
}

// The session moved to a later block: nothing is logged, and the ended block isn't asked about again.
// The goal counts only when a block is ticked.
export const moveSession = (date: ISODate, blockId: ID, db: BriefDB = defaultDb) =>
  dismissUnfinished(date, [movedId(blockId)], db)
