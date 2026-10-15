import type { ID, ISODate, Project, Task } from '../types'
import { dayMonth } from './dates'

// Project hold-back: a project doesn't start until a date (notBefore) or until another project's
// steps are all done or deleted (startsAfterProjectId, cleared by releaseWaiting in db/goals.ts).
// Held-back projects stay out of brief rules 2.3–2.5 and show under "Later" in the Backlog.

type Wait = Pick<Project, 'id' | 'startsAfterProjectId'>

// notBefore is never cleared: once its date comes it simply stops holding the project back.
export const isHeldBack = (p: Pick<Project, 'notBefore' | 'startsAfterProjectId'>, date: ISODate) =>
  !!p.startsAfterProjectId || (!!p.notBefore && p.notBefore > date)

const isOpen = (t: Task) => t.status === 'backlog' || t.status === 'scheduled'

export const hasOpenSteps = (projectId: ID, tasks: Task[]) => tasks.some((t) => t.projectId === projectId && isOpen(t))

// A project with an open repeating step never finishes: done always makes the next occurrence.
export const repeatsForever = (projectId: ID, tasks: Task[]) =>
  tasks.some((t) => t.projectId === projectId && isOpen(t) && !!t.repeat)

// The first loop in the projects' waits, as the ids around it (one id: waits on itself), or null.
export function findWaitLoop(projects: Wait[]): ID[] | null {
  const after = new Map(projects.map((p) => [p.id, p.startsAfterProjectId]))
  for (const start of projects) {
    const path: ID[] = []
    for (let id: ID | undefined = start.id; id && after.has(id); id = after.get(id)) {
      const at = path.indexOf(id)
      if (at >= 0) return path.slice(at)
      path.push(id)
    }
  }
  return null
}

// Projects that `id` may wait on: not itself, not manual-only (they never finish), and not one that
// already waits on it, directly or down a chain.
export function waitCandidates(id: ID | undefined, projects: Project[]): Project[] {
  const after = new Map(projects.map((p) => [p.id, p.startsAfterProjectId]))
  const waitsOn = (from: ID, target: ID) => {
    const seen = new Set<ID>()
    for (let x = after.get(from); x && !seen.has(x); x = after.get(x)) {
      if (x === target) return true
      seen.add(x)
    }
    return false
  }
  return projects.filter((p) => p.id !== id && !p.manualOnly && !(id && waitsOn(p.id, id)))
}

// Why a held-back project waits, for its Later row.
export function heldBackLabel(p: Project, projects: Project[], tasks: Task[]): string {
  if (p.startsAfterProjectId) {
    const title = projects.find((x) => x.id === p.startsAfterProjectId)?.title ?? 'another project'
    return repeatsForever(p.startsAfterProjectId, tasks) ? `After ${title} (${title} repeats, won't finish)` : `After ${title}`
  }
  return `Not before ${dayMonth(p.notBefore!)}`
}
