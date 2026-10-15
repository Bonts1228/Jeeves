import { isoDate, weekdayOf } from '../lib/dates'
import { minutesOfDay, overlaps, toMinutes } from '../lib/time'
import type { Block, ID, ISODate, Minutes, Task } from '../types'
import { type BriefDB, db as defaultDb, newId } from './db'
import { renumber, stepListOf } from './steps'

// Meta key marking a date whose blocks were made, so a day edited down to no template blocks stays as
// edited. Device-only; import clears these (the "any template block" check covers imported days).
export const BLOCKS_MADE_PREFIX = 'blocks:'
const madeKey = (date: ISODate) => `${BLOCKS_MADE_PREFIX}${date}`

// Make a date's blocks from its weekday's templates. Runs once per date: once made (or if any template
// block already exists for it), the day's blocks stand as edited. IDs are stable so racing calls don't duplicate.
export async function ensureBlocks(date: ISODate, db: BriefDB = defaultDb): Promise<Block[]> {
  return db.transaction('rw', db.blocks, db.blockTemplates, db.meta, async () => {
    const existing = await db.blocks.where('date').equals(date).toArray()
    if (existing.some((b) => b.templateId) || (await db.meta.get(madeKey(date)))) return existing
    const templates = await db.blockTemplates.where('weekday').equals(weekdayOf(date)).toArray()
    const made: Block[] = templates.map(({ id, areaId, start, end, protected: prot }) => ({
      id: `${id}@${date}`,
      templateId: id,
      areaId,
      date,
      start,
      end,
      protected: prot,
    }))
    await db.blocks.bulkPut(made)
    await db.meta.put('1', madeKey(date))
    return [...existing, ...made]
  })
}

// Minutes left in a block for new tasks. Today's blocks lose the time already gone.
export function blockRoom(block: Block, scheduled: Task[], now = new Date()): Minutes {
  const start =
    block.date === isoDate(now) ? Math.max(toMinutes(block.start), minutesOfDay(now)) : toMinutes(block.start)
  const used = scheduled
    .filter((t) => t.status === 'scheduled' && t.blockId === block.id)
    .reduce((sum, t) => sum + t.estimate, 0)
  return Math.max(0, toMinutes(block.end) - start - used)
}

export interface BlockWithRoom {
  block: Block
  room: Minutes
}

// Non-protected blocks on a date (any area unless areaId is given), in time order, with room for
// a task of this estimate. excludeTaskId: a task being moved, whose own minutes don't count.
export async function blocksWithRoom(
  date: ISODate,
  estimate: Minutes,
  {
    now = new Date(),
    db = defaultDb,
    areaId,
    excludeTaskId,
  }: { now?: Date; db?: BriefDB; areaId?: ID; excludeTaskId?: ID } = {},
): Promise<BlockWithRoom[]> {
  const blocks = await ensureBlocks(date, db)
  const scheduled = (await db.tasks.where('date').equals(date).toArray()).filter((t) => t.id !== excludeTaskId)
  return blocks
    .filter((b) => !b.protected && (!areaId || b.areaId === areaId))
    .map((block) => ({ block, room: blockRoom(block, scheduled, now) }))
    .filter(({ room }) => room >= estimate)
    .sort((a, b) => toMinutes(a.block.start) - toMinutes(b.block.start))
}

// Why a one-off block can't be made, or null if it can.
export function oneOffProblem(
  draft: { start: string; end: string },
  estimate: Minutes,
  dayBlocks: Block[],
  date: ISODate,
  now = new Date(),
): string | null {
  if (!draft.start || !draft.end) return 'Pick a start and end.'
  const length = toMinutes(draft.end) - toMinutes(draft.start)
  if (length <= 0) return 'End must be after start.'
  if (date === isoDate(now) && toMinutes(draft.start) < minutesOfDay(now)) return 'Start must be later than now.'
  if (length < estimate) return 'Too short for this task.'
  const clash = dayBlocks.find((b) => overlaps(b, draft))
  if (clash) return `Overlaps ${clash.start}–${clash.end}.`
  return null
}

// Why a block can't take these times on its day, or null if it can (the per-day block editor).
// Today a block must end after now; other days any times will do. selfId: the block being edited.
export function blockEditProblem(
  draft: { start: string; end: string },
  dayBlocks: Block[],
  date: ISODate,
  now = new Date(),
  selfId?: ID,
): string | null {
  if (!draft.start || !draft.end) return 'Pick a start and end.'
  if (toMinutes(draft.end) <= toMinutes(draft.start)) return 'End must be after start.'
  if (date === isoDate(now) && toMinutes(draft.end) <= minutesOfDay(now)) return 'Must end after now.'
  const clash = [...dayBlocks]
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    .find((b) => b.id !== selfId && overlaps(b, draft))
  if (clash) return `Overlaps ${clash.start}–${clash.end}.`
  return null
}

export type Placement = { blockId: ID } | { newBlock: { start: string; end: string; areaId: ID } }

export interface Schedule {
  date: ISODate
  placement: Placement
}

// The room check every placement goes through, inside the caller's transaction (tasks + blocks).
// Returns the block to use (making a one-off block if asked), or null if the task won't fit.
// Never displaces: room only counts what's free. excludeTaskId: the task being moved.
// force: put it in the given block even without room (quick add into a running block).
export async function resolvePlacement(
  db: BriefDB,
  { date, placement }: Schedule,
  estimate: Minutes,
  now: Date,
  excludeTaskId?: ID,
  force = false,
): Promise<ID | null> {
  if ('blockId' in placement) {
    const block = await db.blocks.get(placement.blockId)
    if (!block || block.date !== date || block.protected) return null
    if (force) return block.id
    const scheduled = (await db.tasks.where('date').equals(date).toArray()).filter((t) => t.id !== excludeTaskId)
    return blockRoom(block, scheduled, now) >= estimate ? block.id : null
  }
  const dayBlocks = await db.blocks.where('date').equals(date).toArray()
  if (oneOffProblem(placement.newBlock, estimate, dayBlocks, date, now)) return null
  const id = newId()
  await db.blocks.add({ id, date, protected: false, ...placement.newBlock })
  return id
}

// Schedule a new task on a date, either into a block with room or into a new one-off block.
// If the block no longer has room, nothing is written and this returns false.
// inboxId: the Inbox item this task came from, removed in the same transaction.
// force: into the given block even if it goes over (quick add into a running block).
export async function scheduleNewTask(
  task: Task,
  date: ISODate,
  placement: Placement,
  { now = new Date(), db = defaultDb, inboxId, force }: { now?: Date; db?: BriefDB; inboxId?: ID; force?: boolean } = {},
): Promise<boolean> {
  await ensureBlocks(date, db)
  return db.transaction('rw', [db.tasks, db.blocks, db.inbox, db.goals, db.projects], async () => {
    const blockId = await resolvePlacement(db, { date, placement }, task.estimate, now, undefined, force)
    if (!blockId) return false
    const { order: _, ...unordered } = task // renumber decides the order
    await db.tasks.add({ ...unordered, status: 'scheduled', date, blockId, reason: 'Added by you' })
    await renumber(db, stepListOf(task))
    if (inboxId) await db.inbox.delete(inboxId)
    return true
  })
}
