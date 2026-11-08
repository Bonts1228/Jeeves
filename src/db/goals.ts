import { type Goal, HOUSEKEEPING_ID, type ID, type Project, type Task } from '../types'
import { type BriefDB, db as defaultDb } from './db'
import { renumber } from './steps'

// Goals and projects. Saving never touches log entries: progress is computed from them, so a new
// target or period just recomputes. A manual-only toggle renumbers the project's steps: becoming
// ordered numbers them oldest first; becoming unordered clears their order.

// Housekeeping stays the system goal: open path, no target, whatever is sent.
export async function saveGoal(goal: Goal, db: BriefDB = defaultDb) {
  const clean: Goal = { ...goal }
  if (clean.type !== 'recurring') delete clean.servedByBlocks
  if (clean.id === HOUSEKEEPING_ID) {
    Object.assign(clean, { type: 'open_path', isHousekeeping: true })
    delete clean.target
    delete clean.period
    delete clean.servedByBlocks
  } else delete clean.isHousekeeping
  await db.goals.put(clean)
}

// A wait on a project with nothing open is already over, so it isn't kept. A project moved to
// another goal takes its tasks with it (done ones too: they're its history).
export async function saveProject(project: Project, db: BriefDB = defaultDb) {
  await db.transaction('rw', [db.goals, db.projects, db.tasks], async () => {
    const clean: Project = { ...project }
    if (clean.startsAfterProjectId && !(await hasOpen(db, clean.startsAfterProjectId))) delete clean.startsAfterProjectId
    await db.projects.put(clean)
    await db.tasks.where('projectId').equals(project.id).modify({ goalId: project.goalId })
    await renumber(db, { projectId: project.id })
  })
}

const hasOpen = async (db: BriefDB, projectId: ID) =>
  (await db.tasks.where('projectId').equals(projectId).filter(isOpen).count()) > 0

// Once every step of a project is done or deleted, the projects waiting on it start: their
// startsAfterProjectId clears. Undo done doesn't bring the wait back. Call inside a transaction on
// tasks and projects wherever a project's last open step can go (done, delete, moved out).
export async function releaseWaiting(db: BriefDB, projectId: ID | undefined) {
  if (!projectId || (await hasOpen(db, projectId))) return
  await db.projects.where('startsAfterProjectId').equals(projectId).modify((p) => {
    delete p.startsAfterProjectId
  })
}

export interface Affected {
  open: number // backlog or scheduled: kept (moved to Housekeeping, or out of the project) or deleted, as chosen
  done: number // always kept as history
  projects: number // goal only: its projects, which move to Housekeeping with their tasks
  waiting: number // project only: projects waiting on it, which start now
}

const linkedTasks = async (db: BriefDB, field: 'goalId' | 'projectId', id: ID) =>
  (await db.tasks.where(field).equals(id).toArray()).filter((t) => t.status !== 'deleted')

const isOpen = (t: Task) => t.status === 'backlog' || t.status === 'scheduled'

export async function affectedBy(kind: 'goal' | 'project', id: ID, db: BriefDB = defaultDb): Promise<Affected> {
  // A goal's own tasks: its projects' steps move with their project
  const tasks = (await linkedTasks(db, kind === 'goal' ? 'goalId' : 'projectId', id)).filter(
    (t) => kind === 'project' || !t.projectId,
  )
  return {
    open: tasks.filter(isOpen).length,
    done: tasks.filter((t) => t.status === 'done').length,
    projects: kind === 'goal' ? await db.projects.where('goalId').equals(id).count() : 0,
    waiting: kind === 'project' ? await db.projects.where('startsAfterProjectId').equals(id).count() : 0,
  }
}

// Delete a goal or project. Log entries are never touched. Housekeeping can't be deleted.
// A goal: its projects move to Housekeeping with their steps; its own open tasks move there too
// ('keep') or are deleted ('delete'); done ones move there as history (their log entries keep the
// goal id).
// A project: its open tasks stay under its goal as the goal's own tasks ('keep') or are deleted;
// done ones stay too. Projects waiting on it start.
export async function deleteGoalOrProject(
  kind: 'goal' | 'project',
  id: ID,
  mode: 'keep' | 'delete',
  db: BriefDB = defaultDb,
) {
  if (kind === 'goal' && id === HOUSEKEEPING_ID) return
  await db.transaction('rw', [db.goals, db.projects, db.tasks], async () => {
    if (kind === 'goal') {
      for (const p of await db.projects.where('goalId').equals(id).toArray()) {
        await db.projects.update(p.id, { goalId: HOUSEKEEPING_ID })
        await db.tasks.where('projectId').equals(p.id).modify({ goalId: HOUSEKEEPING_ID })
      }
      // Every task needs a goal that exists, so even done and deleted ones move
      await db.tasks.where('goalId').equals(id).modify((t) => {
        t.goalId = HOUSEKEEPING_ID
        if (isOpen(t) && mode === 'delete') t.status = 'deleted'
      })
      await db.goals.delete(id)
    } else {
      for (const t of await linkedTasks(db, 'projectId', id)) {
        const unlink = { projectId: undefined, order: undefined }
        await db.tasks.update(t.id, isOpen(t) && mode === 'delete' ? { ...unlink, status: 'deleted' } : unlink)
      }
      await db.projects.delete(id)
      await db.projects.where('startsAfterProjectId').equals(id).modify((p) => {
        delete p.startsAfterProjectId
      })
    }
  })
}

// Fill in or change a log entry's details afterwards (a skipped form, a typo). Only details change:
// never when it was done or what it counts against. Undefined clears them.
export async function updateDetails(logId: ID, details: Record<string, string> | undefined, db: BriefDB = defaultDb) {
  await db.transaction('rw', db.logEntries, async () => {
    const entry = await db.logEntries.get(logId)
    if (!entry) return
    const { details: _, ...rest } = entry
    await db.logEntries.put(details ? { ...rest, details } : rest)
  })
}
