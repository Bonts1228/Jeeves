import type { Goal, LogEntry, Project, Task } from '../types'

// Progress is computed, never stored: log entries for a goal in its current period, against target.

// Start of the current period: Monday 00:00 for a week, the 1st for a month (local time).
export function periodStart(period: 'week' | 'month', now: Date): Date {
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

// Start of the period after the current one.
function periodEnd(period: 'week' | 'month', now: Date): Date {
  const start = periodStart(period, now)
  return period === 'month'
    ? new Date(start.getFullYear(), start.getMonth() + 1, 1)
    : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
}

// For goals with a target and period: { done, target }. Otherwise null (set paths count steps instead).
// Counts the whole current period, so a display clock a few seconds behind still counts a fresh tick.
export function goalProgress(goal: Goal, logs: LogEntry[], now = new Date()) {
  if (!goal.target || !goal.period) return null
  const from = periodStart(goal.period, now).toISOString()
  const to = periodEnd(goal.period, now).toISOString()
  const done = logs.filter((l) => l.goalId === goal.id && l.completedAt >= from && l.completedAt < to).length
  return { done, target: goal.target }
}

const isOpen = (t: Task) => t.status === 'backlog' || t.status === 'scheduled'
const byOrder = (a: Task, b: Task) => (a.order ?? Infinity) - (b.order ?? Infinity)

// The one number on a goal's Backlog row (a number, never a colour). tasks: all non-deleted tasks.
// A block-served goal counts log entries like any other: one per ticked block (db/day.ts), plus its tasks
// done outside its blocks.
export function goalNumber(goal: Goal, tasks: Task[], logs: LogEntry[], now = new Date()): string {
  if (goal.type === 'set_path') {
    const steps = tasks.filter((t) => t.goalId === goal.id && !t.projectId && t.status !== 'deleted')
    return stepCount(steps)
  }
  const progress = goalProgress(goal, logs, now)
  if (progress) return `${progress.done} of ${progress.target} this ${goal.period}`
  return `${logs.filter((l) => l.goalId === goal.id).length} done`
}

// Next open step of a set path or ordered project, if any.
export function nextStep(tasks: Task[]): Task | undefined {
  return tasks.filter(isOpen).sort(byOrder)[0]
}

// Ordered projects count steps; manual-only ones (Housekeeping) just count what's open.
export function projectNumber(project: Project, tasks: Task[]): string {
  const steps = tasks.filter((t) => t.projectId === project.id && t.status !== 'deleted')
  if (project.manualOnly) return `${steps.filter(isOpen).length} open`
  return stepCount(steps)
}

const stepCount = (steps: Task[]) =>
  `${steps.filter((t) => t.status === 'done').length} of ${steps.length} step${steps.length === 1 ? '' : 's'}`
