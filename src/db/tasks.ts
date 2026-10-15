import { isoDate } from '../lib/dates'
import { loggedGoal } from '../lib/progress'
import { nextDue } from '../lib/repeat'
import type { Goal, ID, Repeat, Task } from '../types'
import { ensureBlocks, resolvePlacement, type Schedule } from './blocks'
import { type BriefDB, db as defaultDb, newId } from './db'
import { releaseWaiting } from './goals'
import { renumber, sameList, stepListOf } from './steps'

// Add a new Backlog task (a new step goes last). inboxId: the Inbox item it came from, removed in
// the same transaction.
export async function addTask(task: Task, { db = defaultDb, inboxId }: { db?: BriefDB; inboxId?: ID } = {}) {
  await db.transaction('rw', [db.tasks, db.inbox, db.goals, db.projects], async () => {
    const { order: _, ...unordered } = task // renumber decides the order
    await db.tasks.add(unordered)
    await renumber(db, stepListOf(task))
    if (inboxId) await db.inbox.delete(inboxId)
  })
}

export type TaskPatch = Partial<Pick<Task, 'title' | 'estimate' | 'areaId' | 'goalId' | 'projectId' | 'due' | 'repeat'>>

// Edit an open task. An undefined value in patch clears that field.
// schedule: undefined keeps the placement, null unschedules (back to Backlog), else moves it.
// A bigger estimate or a new block goes through the same room check as new tasks: if it no longer
// fits, nothing is written and this returns 'no-room'. Done and deleted tasks aren't edited ('closed').
// A changed repeat rule also applies to later open occurrences; done ones are never touched.
// Moving to another goal/project puts the task last there and closes the gap it left.
export async function updateTask(
  id: ID,
  patch: TaskPatch,
  schedule?: Schedule | null,
  { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {},
): Promise<'ok' | 'no-room' | 'closed'> {
  const before = await db.tasks.get(id)
  const estimate = patch.estimate ?? before?.estimate ?? 0
  // A scheduled task that grows is re-checked in its own block
  if (schedule === undefined && before?.status === 'scheduled' && estimate > before.estimate)
    schedule = { date: before.date!, placement: { blockId: before.blockId! } }
  if (schedule) await ensureBlocks(schedule.date, db)

  return db.transaction('rw', [db.tasks, db.blocks, db.goals, db.projects], async () => {
    const task = await db.tasks.get(id)
    if (!task || (task.status !== 'backlog' && task.status !== 'scheduled')) return 'closed'
    const changes: Partial<Task> = { ...patch }
    const fromList = stepListOf(task)
    const toList = stepListOf({ ...task, ...patch })
    const moved = !sameList(fromList, toList)
    if (moved) changes.order = undefined

    if (schedule === null) {
      Object.assign(changes, { status: 'backlog', date: undefined, blockId: undefined, reason: undefined })
    } else if (schedule) {
      const unmoved =
        task.status === 'scheduled' &&
        schedule.date === task.date &&
        'blockId' in schedule.placement &&
        schedule.placement.blockId === task.blockId
      if (!unmoved || estimate > task.estimate) {
        const blockId = await resolvePlacement(db, schedule, estimate, now, id)
        if (!blockId) return 'no-room'
        Object.assign(changes, { status: 'scheduled', date: schedule.date, blockId, reason: task.reason ?? 'Added by you' })
      }
    }
    await db.tasks.update(id, changes)
    if (moved) {
      await renumber(db, fromList)
      await renumber(db, toList)
    }
    if ('projectId' in patch && patch.projectId !== task.projectId) await releaseWaiting(db, task.projectId)

    if ('repeat' in patch && !sameRepeat(patch.repeat, task.repeat)) {
      for (let next = await successor(db, id); next; next = await successor(db, next.id))
        if (next.status === 'backlog' || next.status === 'scheduled') await db.tasks.update(next.id, { repeat: patch.repeat })
    }
    return 'ok'
  })
}

const successor = (db: BriefDB, id: ID) => db.tasks.where('prevId').equals(id).first()

const sameRepeat = (a?: Repeat, b?: Repeat) => JSON.stringify(a) === JSON.stringify(b)

// What ticking a task logs against: the goal id (kept even if that goal row is gone) and the goal,
// unless a served-by-blocks block covers it (lib/progress loggedGoal).
async function tickTarget(db: BriefDB, task: Task): Promise<{ goalId?: ID; goal?: Goal }> {
  const project = task.projectId ? await db.projects.get(task.projectId) : undefined
  const goalId = task.goalId ?? project?.goalId
  const goal = goalId ? await db.goals.get(goalId) : undefined
  const block = task.blockId ? await db.blocks.get(task.blockId) : undefined
  if (goal && !loggedGoal(task, goal, block)) return {}
  return { goalId, goal }
}

// The goal ticking this task would log against, or undefined. The UI asks for its detail fields first.
export async function tickGoal(id: ID, db: BriefDB = defaultDb): Promise<Goal | undefined> {
  const task = await db.tasks.get(id)
  return task && (await tickTarget(db, task)).goal
}

// Ticking done is the only completion signal. Writes a LogEntry against the task's goal (or its
// project's goal) and, for a repeating task, creates the next occurrence. A task has at most one
// next occurrence (linked by prevId), so completing twice or complete → undo → complete never duplicates.
// A goal served by blocks counts its blocks: a task done in one of its area's blocks is covered by
// the block tick, so its entry doesn't count against the goal. Done anywhere else, it counts.
// now: when it was done ("Did it" on the Unfinished sheet logs as of the block's end).
export async function completeTask(
  id: ID,
  { details, now = new Date(), db = defaultDb }: { details?: Record<string, string>; now?: Date; db?: BriefDB } = {},
) {
  await db.transaction('rw', [db.tasks, db.logEntries, db.goals, db.projects, db.blocks], async () => {
    const task = await db.tasks.get(id)
    if (!task || task.status === 'done' || task.status === 'deleted') return

    const { goalId } = await tickTarget(db, task)
    await db.tasks.update(id, { status: 'done' })
    await db.logEntries.add({
      id: newId(),
      taskId: id,
      ...(goalId && { goalId }),
      completedAt: now.toISOString(),
      ...(details && { details }),
    })

    if (task.repeat && (await db.tasks.where('prevId').equals(id).count()) === 0) await addNext(db, task, task.repeat, now)
    await releaseWaiting(db, task.projectId)
  })
}

// The next occurrence of a repeating task just ticked done.
async function addNext(db: BriefDB, task: Task, repeat: Repeat, now: Date) {
  const next: Task = {
    ...task,
    id: newId(),
    prevId: task.id,
    status: 'backlog',
    due: nextDue(repeat, isoDate(now), task.due),
    rollovers: 0,
    createdAt: now.toISOString(),
  }
  delete next.date
  delete next.blockId
  delete next.reason
  delete next.order // a repeating step's next occurrence goes last
  await db.tasks.add(next)
  await renumber(db, stepListOf(next))
}

// Undo a tick: reopen the task, drop its LogEntry, and remove the next occurrence if it's still open.
// A done or deleted next occurrence stays, so re-ticking can't duplicate or restart an ended series.
export async function uncompleteTask(id: ID, db: BriefDB = defaultDb) {
  await db.transaction('rw', [db.tasks, db.logEntries, db.goals, db.projects], async () => {
    const task = await db.tasks.get(id)
    if (task?.status !== 'done') return

    await db.tasks.update(id, { status: task.date ? 'scheduled' : 'backlog' })
    const entries = await db.logEntries.where('taskId').equals(id).sortBy('completedAt')
    const last = entries.at(-1)
    if (last) await db.logEntries.delete(last.id)
    await db.tasks
      .where('prevId')
      .equals(id)
      .filter((t) => t.status === 'backlog' || t.status === 'scheduled')
      .delete()
    await renumber(db, stepListOf(task))
  })
}

// Delete ends a repeating series: no next occurrence is created. The steps after it close up.
export async function deleteTask(id: ID, db: BriefDB = defaultDb) {
  await db.transaction('rw', [db.tasks, db.goals, db.projects], async () => {
    const task = await db.tasks.get(id)
    if (!task) return
    await db.tasks.update(id, { status: 'deleted', order: undefined })
    await renumber(db, stepListOf(task))
    await releaseWaiting(db, task.projectId)
  })
}
