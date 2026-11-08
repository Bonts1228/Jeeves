import { HOUSEKEEPING_ID, type ID, type Task } from '../types'
import { type BriefDB, db as defaultDb } from './db'

// Step order. A (non-manual) project's tasks are an ordered list: every non-deleted step, done ones
// included, has order 1..n with no gaps or duplicates. The order is a suggestion, never a gate.
// A goal's own tasks have no order. renumber() is the one place that enforces this; every change to a
// list (add, move, delete, done, undo, type change) calls it in the same transaction.

export type StepList = { projectId: ID } | { goalId: ID }

// A task belongs to its project's list if it has one, else its goal's.
export function stepListOf(task: Pick<Task, 'projectId' | 'goalId'>): StepList {
  return task.projectId ? { projectId: task.projectId } : { goalId: task.goalId }
}

// Every task has a home: its project's goal if it's in a project, else its goal, else Housekeeping.
// Call inside a transaction on projects.
export async function homeOf(db: BriefDB, task: Partial<Pick<Task, 'projectId' | 'goalId'>>): Promise<ID> {
  const project = task.projectId ? await db.projects.get(task.projectId) : undefined
  return project?.goalId ?? (task.goalId || HOUSEKEEPING_ID)
}

export const sameList = (a: StepList | null, b: StepList | null) => JSON.stringify(a) === JSON.stringify(b)

async function listTasks(db: BriefDB, list: StepList): Promise<Task[]> {
  const tasks =
    'projectId' in list
      ? await db.tasks.where('projectId').equals(list.projectId).toArray()
      : (await db.tasks.where('goalId').equals(list.goalId).toArray()).filter((t) => !t.projectId)
  return tasks.filter((t) => t.status !== 'deleted')
}

async function isOrdered(db: BriefDB, list: StepList): Promise<boolean> {
  if (!('projectId' in list)) return false
  const project = await db.projects.get(list.projectId)
  return !!project && !project.manualOnly
}

// Ordered: keep the current sequence, unordered tasks (new or moved in) last, oldest first; write 1..n.
// Unordered: clear any order. Deleted tasks never hold an order. Call inside a transaction on
// tasks, goals and projects.
export async function renumber(db: BriefDB, list: StepList) {
  const tasks = await listTasks(db, list)
  if (!(await isOrdered(db, list))) {
    for (const t of tasks) if (t.order !== undefined) await db.tasks.update(t.id, { order: undefined })
    return
  }
  tasks.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt.localeCompare(b.createdAt))
  for (const [i, t] of tasks.entries()) if (t.order !== i + 1) await db.tasks.update(t.id, { order: i + 1 })
}

export async function stepsOf(list: StepList, db: BriefDB = defaultDb): Promise<Task[]> {
  const tasks = await listTasks(db, list)
  return tasks.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt.localeCompare(b.createdAt))
}

// Move an open step up (-1) or down (+1) past the nearest open step; done steps keep their place.
export async function moveStep(id: ID, dir: -1 | 1, db: BriefDB = defaultDb) {
  await db.transaction('rw', db.tasks, db.goals, db.projects, async () => {
    const task = await db.tasks.get(id)
    const list = task && stepListOf(task)
    if (!task || !list || task.order === undefined || !(await isOrdered(db, list))) return
    const open = (await stepsOf(list, db)).filter((t) => t.status === 'backlog' || t.status === 'scheduled')
    const other = open[open.findIndex((t) => t.id === id) + dir]
    if (!other) return
    await db.tasks.update(id, { order: other.order })
    await db.tasks.update(other.id, { order: task.order })
    await renumber(db, list)
  })
}
