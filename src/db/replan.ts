import { cadence, isAnyAreaTask } from '../lib/brief'
import { isoDate, weekdayOf } from '../lib/dates'
import { type Move, replanUrgent } from '../lib/replan'
import type { ID, Task } from '../types'
import { ensureBlocks } from './blocks'
import { type BriefDB, db as defaultDb, SETTINGS_KEY } from './db'
import { homeOf, renumber, stepListOf } from './steps'

// Urgent capture (M6): save a new task due today and re-plan today's remaining blocks around it
// (lib/replan). Undo puts every task back exactly as it was, from a snapshot kept in memory.

export interface UrgentSnapshot {
  taskId: ID
  moved: { before: Task; after: Pick<Task, 'status' | 'date' | 'blockId'> }[]
}

export type UrgentResult =
  | { placed: true; blockId: ID; moves: Move[]; snapshot: UrgentSnapshot }
  // Fits nowhere today: saved to the Backlog (due today), nothing moved
  | { placed: false; why: 'no-block' | 'no-room' }

export const isUrgent = (task: Pick<Task, 'due'>, now = new Date()) => task.due === isoDate(now)

export async function addUrgent(
  task: Task,
  { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {},
): Promise<UrgentResult> {
  const today = isoDate(now)
  await ensureBlocks(today, db)
  return db.transaction('rw', [db.tasks, db.blocks, db.goals, db.projects, db.settings], async () => {
    const [blocks, tasks, goals, projects, settings] = await Promise.all([
      db.blocks.where('date').equals(today).toArray(),
      db.tasks.where('date').equals(today).toArray(),
      db.goals.toArray(),
      db.projects.toArray(),
      db.settings.get(SETTINGS_KEY),
    ])
    const anyArea = isAnyAreaTask(task, projects)
    const capacity = settings?.capacity[weekdayOf(today)] ?? Infinity
    const plan = replanUrgent({ task, anyArea, now, blocks, tasks, capacity, refs: { goals, projects } })
    const { order: _, ...rest } = task // renumber decides the order
    const unordered = { ...rest, goalId: await homeOf(db, task) }

    if (plan.blockId === null) {
      await db.tasks.add({ ...unordered, status: 'backlog' })
    } else {
      const reason = ['Due today', task.repeat && cadence(task.repeat)].filter(Boolean).join(' · ')
      await db.tasks.add({ ...unordered, status: 'scheduled', date: today, blockId: plan.blockId, reason })
      for (const { task: t, to } of plan.moves)
        await db.tasks.update(
          t.id,
          to ? { blockId: to } : { status: 'backlog', date: undefined, blockId: undefined, reason: undefined },
        )
    }
    await renumber(db, stepListOf(unordered))
    if (plan.blockId === null) return { placed: false, why: plan.why }

    const moved = plan.moves.map(({ task: before, to }) => ({
      before,
      after: to
        ? { status: 'scheduled' as const, date: today, blockId: to }
        : { status: 'backlog' as const, date: undefined, blockId: undefined },
    }))
    return { placed: true, blockId: plan.blockId, moves: plan.moves, snapshot: { taskId: task.id, moved } }
  })
}

// Undo an urgent capture: remove the new task and put each moved task back exactly as it was.
// A moved task changed since (ticked, moved again) is left alone, and so is a new task already ticked. Returns the titles left alone.
export async function undoUrgent(snapshot: UrgentSnapshot, db: BriefDB = defaultDb): Promise<string[]> {
  return db.transaction('rw', [db.tasks, db.goals, db.projects], async () => {
    const skipped: string[] = []
    const task = await db.tasks.get(snapshot.taskId)
    const removable = !!task && (task.status === 'backlog' || task.status === 'scheduled')
    if (removable) {
      await db.tasks.delete(task.id)
      await renumber(db, stepListOf(task))
    } else if (task) skipped.push(task.title)
    for (const { before, after } of snapshot.moved) {
      const now = await db.tasks.get(before.id)
      const unchanged = now && now.status === after.status && now.date === after.date && now.blockId === after.blockId
      if (unchanged) await db.tasks.put(before)
      else skipped.push(before.title)
    }
    return skipped
  })
}
