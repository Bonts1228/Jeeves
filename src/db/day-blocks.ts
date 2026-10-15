import { isoDate } from '../lib/dates'
import type { ID, ISODate } from '../types'
import { blockEditProblem, ensureBlocks } from './blocks'
import { type BriefDB, db as defaultDb, newId } from './db'
import { updateTask } from './tasks'

// Per-day block editor: change one day's blocks; templates are never touched.

// New times for a block, that day only. Returns the problem (nothing written) or null.
export async function updateBlockTimes(
  id: ID,
  times: { start: string; end: string },
  { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {},
): Promise<string | null> {
  return db.transaction('rw', db.blocks, async () => {
    const block = await db.blocks.get(id)
    if (!block) return 'This block is gone.'
    const dayBlocks = await db.blocks.where('date').equals(block.date).toArray()
    const problem = blockEditProblem(times, dayBlocks, block.date, now, id)
    if (!problem) await db.blocks.update(id, times)
    return problem
  })
}

// An empty one-off block on the date. Returns the problem (nothing written) or null.
export async function addBlock(
  date: ISODate,
  draft: { areaId: ID; start: string; end: string },
  { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {},
): Promise<string | null> {
  await ensureBlocks(date, db)
  return db.transaction('rw', db.blocks, async () => {
    const problem = blockEditProblem(draft, await db.blocks.where('date').equals(date).toArray(), date, now)
    if (!problem) await db.blocks.add({ id: newId(), date, protected: false, ...draft })
    return problem
  })
}

// Delete a block from its day. Today (or earlier) its open tasks stay put, pointing at the gone
// block, so they show as Unfinished. On a later day they go back to the Backlog without a rollover,
// for that day's brief to place again.
export async function deleteBlock(id: ID, { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {}) {
  await db.transaction('rw', [db.blocks, db.tasks, db.goals, db.projects], async () => {
    const block = await db.blocks.get(id)
    if (!block) return
    if (block.date > isoDate(now)) {
      const open = await db.tasks.where('blockId').equals(id).filter((t) => t.status === 'scheduled').toArray()
      for (const t of open) await updateTask(t.id, {}, null, { now, db })
    }
    await db.blocks.delete(id)
  })
}
