import { servedGoal } from '../lib/day'
import type { ID } from '../types'
import { type BriefDB, db as defaultDb, newId } from './db'

// Block goals: each block in a servedByBlocks goal's area gets a Done tick, which logs one entry
// (blockId + goalId) against the goal. Ticking twice does nothing; untick removes it.

export async function tickBlock(blockId: ID, { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {}) {
  await db.transaction('rw', [db.blocks, db.goals, db.logEntries], async () => {
    const block = await db.blocks.get(blockId)
    const goal = block && servedGoal(block, await db.goals.toArray())
    if (!goal || (await db.logEntries.where('blockId').equals(blockId).count())) return
    await db.logEntries.add({ id: newId(), goalId: goal.id, blockId, completedAt: now.toISOString() })
  })
}

export async function untickBlock(blockId: ID, db: BriefDB = defaultDb) {
  await db.logEntries.where('blockId').equals(blockId).delete()
}
