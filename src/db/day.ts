import { servedGoal } from '../lib/day'
import type { ID } from '../types'
import { type BriefDB, db as defaultDb, newId } from './db'

// Block goals: each block in a servedByBlocks goal's area gets a Done tick, which logs one entry
// (blockId + goalId) against the goal. Ticking twice does nothing; untick removes it.

// details: the goal's detail fields, filled in on the tick (or skipped).
export async function tickBlock(
  blockId: ID,
  { details, now = new Date(), db = defaultDb }: { details?: Record<string, string>; now?: Date; db?: BriefDB } = {},
) {
  await db.transaction('rw', [db.blocks, db.goals, db.logEntries], async () => {
    const block = await db.blocks.get(blockId)
    const goal = block && servedGoal(block, await db.goals.toArray())
    if (!goal || (await db.logEntries.where('blockId').equals(blockId).count())) return
    await db.logEntries.add({
      id: newId(),
      goalId: goal.id,
      blockId,
      completedAt: now.toISOString(),
      ...(details && { details }),
    })
  })
}

export async function untickBlock(blockId: ID, db: BriefDB = defaultDb) {
  await db.logEntries.where('blockId').equals(blockId).delete()
}
