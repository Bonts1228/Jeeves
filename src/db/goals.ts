import type { Goal, ID, Project, Task } from '../types'
import { type BriefDB, db as defaultDb } from './db'
import { renumber } from './steps'

// Goals and projects. Saving never touches log entries: progress is computed from them, so a new
// target or period just recomputes. A type change (or manual-only toggle) renumbers the step list:
// becoming ordered numbers the steps oldest first; becoming unordered clears their order.

export async function saveGoal(goal: Goal, db: BriefDB = defaultDb) {
  await db.transaction('rw', [db.goals, db.projects, db.tasks], async () => {
    const clean: Goal = { ...goal }
    if (clean.type !== 'recurring') delete clean.servedByBlocks
    if (clean.type === 'set_path') {
      delete clean.target
      delete clean.period
    }
    await db.goals.put(clean)
    await renumber(db, { goalId: goal.id })
  })
}

export async function saveProject(project: Project, db: BriefDB = defaultDb) {
  await db.transaction('rw', [db.goals, db.projects, db.tasks], async () => {
    await db.projects.put(project)
    await renumber(db, { projectId: project.id })
  })
}

export interface Affected {
  open: number // backlog or scheduled: kept as loose tasks or deleted, as chosen
  done: number // always kept as history, unlinked
  projects: number // goal only: projects that feed it, which stay but stop feeding it
}

const linkedTasks = async (db: BriefDB, field: 'goalId' | 'projectId', id: ID) =>
  (await db.tasks.where(field).equals(id).toArray()).filter((t) => t.status !== 'deleted')

const isOpen = (t: Task) => t.status === 'backlog' || t.status === 'scheduled'

export async function affectedBy(kind: 'goal' | 'project', id: ID, db: BriefDB = defaultDb): Promise<Affected> {
  const tasks = await linkedTasks(db, kind === 'goal' ? 'goalId' : 'projectId', id)
  return {
    open: tasks.filter(isOpen).length,
    done: tasks.filter((t) => t.status === 'done').length,
    projects: kind === 'goal' ? await db.projects.filter((p) => p.goalId === id).count() : 0,
  }
}

// Delete a goal or project. Its open tasks are kept as loose Backlog tasks ('keep') or deleted
// ('delete'); done tasks are kept, unlinked. Projects feeding a deleted goal stay, unlinked.
// Log entries are never touched.
export async function deleteGoalOrProject(
  kind: 'goal' | 'project',
  id: ID,
  mode: 'keep' | 'delete',
  db: BriefDB = defaultDb,
) {
  const field = kind === 'goal' ? 'goalId' : 'projectId'
  await db.transaction('rw', [db.goals, db.projects, db.tasks], async () => {
    const tasks = await linkedTasks(db, field, id)
    const goalIds = new Set(tasks.flatMap((t) => (t.goalId ? [t.goalId] : [])))
    for (const t of tasks) {
      const unlink = { [field]: undefined, ...(field === 'projectId' || !t.projectId ? { order: undefined } : {}) }
      await db.tasks.update(t.id, isOpen(t) && mode === 'delete' ? { ...unlink, status: 'deleted' } : unlink)
    }
    if (kind === 'goal') {
      for (const p of await db.projects.filter((p) => p.goalId === id).toArray())
        await db.projects.update(p.id, { goalId: undefined })
      await db.goals.delete(id)
    } else {
      await db.projects.delete(id)
      // A kept task that also has a goal joins that goal's list
      for (const goalId of goalIds) await renumber(db, { goalId })
    }
  })
}
