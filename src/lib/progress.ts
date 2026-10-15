import type { Block, Goal, ISODate, LogEntry, Project, Task } from '../types'
import { isoDate, parseISODate } from './dates'

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

const DAY_MS = 86_400_000
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS) // whole days, DST-safe

// How many entries an even pace has by the end of date (or by its start, if !inclusive), in the
// period holding date. Brief rule 2.3 plans through the brief date; the Backlog counts finished days.
export function expectedBy(target: number, period: 'week' | 'month', date: ISODate, inclusive = true): number {
  const d = parseISODate(date)
  const start = periodStart(period, d)
  const days = daysBetween(start, periodEnd(period, d))
  const elapsed = daysBetween(start, d) + (inclusive ? 1 : 0)
  return Math.ceil((target * elapsed) / days)
}

// Days left in the current period, today included: "3 days left", "last day".
export function periodLeft(period: 'week' | 'month', now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const n = daysBetween(today, periodEnd(period, now))
  return n <= 1 ? 'last day' : `${n} days left`
}

// The pace line under a goal with a target: "1 behind · 3 days left". Behind only shows when it is
// (a number, never a colour); on pace or ahead there's just the days left.
export function paceLabel(goal: Goal, logs: LogEntry[], now = new Date()): string | null {
  const progress = goalProgress(goal, logs, now)
  if (!progress || !goal.period) return null
  const behind = expectedBy(progress.target, goal.period, isoDate(now), false) - progress.done
  return [behind > 0 && `${behind} behind`, periodLeft(goal.period, now)].filter(Boolean).join(' · ')
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

// The goal a tick logs against: the task's own goal, else its project's (goal: that one, looked up).
// A task done inside a block of its served-by-blocks goal's area logs none: the block tick covers it.
export function loggedGoal(task: Task, goal: Goal | undefined, block: Block | undefined): Goal | undefined {
  const inBlock = (b?: Block): b is Block => task.status === 'scheduled' && !!b && b.id === task.blockId
  if (goal?.servedByBlocks && inBlock(block) && block.areaId === goal.areaId) return undefined
  return goal
}

// The details a goal records ("role", "company"), or none.
export const detailFieldsOf = (goal: Goal | undefined): string[] => goal?.detailFields ?? []

// Only the fields filled in; nothing at all if none were.
export function cleanDetails(values: Record<string, string>): Record<string, string> | undefined {
  const kept = Object.entries(values)
    .map(([k, v]) => [k, v.trim()] as const)
    .filter(([, v]) => v)
  return kept.length ? Object.fromEntries(kept) : undefined
}

// "Analyst, Acme": an entry's details in the goal's field order.
export function detailsText(goal: Goal, details?: Record<string, string>): string {
  if (!details) return ''
  const order = [...detailFieldsOf(goal), ...Object.keys(details).filter((k) => !detailFieldsOf(goal).includes(k))]
  return order.flatMap((k) => (details[k] ? [details[k]] : [])).join(', ')
}

// The latest entry with details, for "Last: Snatch, 80kg" on the Backlog.
export function lastDetails(goal: Goal, logs: LogEntry[]): string {
  const withDetails = logs.filter((l) => l.goalId === goal.id && l.details)
  const last = withDetails.sort((a, b) => a.completedAt.localeCompare(b.completedAt)).at(-1)
  return detailsText(goal, last?.details)
}
