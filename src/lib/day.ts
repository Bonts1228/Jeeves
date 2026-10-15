import type { Block, Goal, ISODate, LogEntry, Minutes, Project, Task } from '../types'
import { isCarriedReason, isOverdueReason } from './brief'
import { isoDate } from './dates'
import { formatDuration, minutesOfDay, toMinutes } from './time'

// The day view (M4), as pure functions: the order of a block's tasks, what's up next, time left.
// Nothing here is stored: order, "current task" and time left are all derived at render.

export interface Refs {
  goals: Goal[]
  projects: Project[]
}

const isOpen = (t: Task) => t.status === 'scheduled'
const oldestFirst = (a: Task, b: Task) => a.createdAt.localeCompare(b.createdAt)

// A block's tasks (open and done) in the brief's rank order (lib/brief.ts rules 2.1–2.5), open first:
// overdue, due (earliest first), recurring count goals, path steps (by path deadline, title, order),
// then the rest oldest first. The brief doesn't store rank; this recomputes it from what it does store
// (a placed overdue task is known by its reason).
export function blockTasks(tasks: Task[], block: Block, { goals, projects }: Refs): Task[] {
  const goalById = new Map(goals.map((g) => [g.id, g]))
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const countGoals = goals.filter((g) => g.type === 'recurring' && !g.servedByBlocks && g.target && g.period)

  // The path a step belongs to, as rule 2.4 sorts paths: deadline, then title
  const path = (t: Task) => {
    const project = t.projectId ? projectById.get(t.projectId) : undefined
    if (project && !project.manualOnly)
      return { deadline: project.goalId ? goalById.get(project.goalId)?.deadline : undefined, title: project.title }
    const goal = !t.projectId && t.goalId ? goalById.get(t.goalId) : undefined
    if (goal?.type === 'set_path') return { deadline: goal.deadline, title: goal.title }
  }
  const tier = (t: Task) => {
    if (isOverdueReason(t.reason)) return 1
    if (t.due && t.due <= block.date) return 2
    if (!t.repeat && countGoals.some((g) => g.id === t.goalId)) return 3
    if (path(t)) return 4
    return 5
  }
  const compare = (a: Task, b: Task) => {
    const ta = tier(a)
    const tb = tier(b)
    if (ta !== tb) return ta - tb
    // Placing an overdue task overwrites its old date, so: older days (rule 2.1 sorts by date) before
    // today's carried ones, then oldest first
    if (ta === 1) return +isCarriedReason(a.reason) - +isCarriedReason(b.reason) || oldestFirst(a, b)
    if (ta === 2) return a.due!.localeCompare(b.due!) || oldestFirst(a, b)
    if (ta === 3) return countGoals.findIndex((g) => g.id === a.goalId) - countGoals.findIndex((g) => g.id === b.goalId) || oldestFirst(a, b)
    if (ta === 4) {
      const pa = path(a)!
      const pb = path(b)!
      return (
        (pa.deadline ?? '9999').localeCompare(pb.deadline ?? '9999') ||
        pa.title.localeCompare(pb.title) ||
        (a.order ?? Infinity) - (b.order ?? Infinity) ||
        oldestFirst(a, b)
      )
    }
    return oldestFirst(a, b)
  }

  const mine = tasks.filter((t) => t.blockId === block.id && (t.status === 'scheduled' || t.status === 'done'))
  return [...mine.filter(isOpen).sort(compare), ...mine.filter((t) => t.status === 'done').sort(compare)]
}

// The recurring goal a block serves (every block in its area counts once), if any.
export function servedGoal(block: Block, goals: Goal[]): Goal | undefined {
  return goals.find((g) => g.type === 'recurring' && g.servedByBlocks && g.areaId === block.areaId)
}

export const blockTicked = (block: Block, logs: LogEntry[]) => logs.some((l) => l.blockId === block.id)

// The goal shown in a block's header: the one the block serves, else the current task's goal.
export function blockGoal(block: Block, task: Task | undefined, { goals, projects }: Refs): Goal | undefined {
  const served = servedGoal(block, goals)
  if (served || !task) return served
  const goalId = task.goalId ?? projects.find((p) => p.id === task.projectId)?.goalId
  return goals.find((g) => g.id === goalId)
}

export type TimeLeft = { state: 'before'; mins: Minutes } | { state: 'during'; mins: Minutes } | { state: 'after' }

// Time left is wall clock to the block's end, so a late start shows what's really left. Not a timer.
export function timeLeft(block: Block, now: Date): TimeLeft {
  const today = isoDate(now)
  if (block.date < today) return { state: 'after' }
  const m = block.date > today ? -Infinity : minutesOfDay(now)
  if (m < toMinutes(block.start)) return { state: 'before', mins: block.date > today ? Infinity : toMinutes(block.start) - m }
  if (m < toMinutes(block.end)) return { state: 'during', mins: toMinutes(block.end) - m }
  return { state: 'after' }
}

// "1h 20m left", "in 40m", "Ended"
export function whenLabel(block: Block, now: Date): string {
  const left = timeLeft(block, now)
  if (left.state === 'during') return `${formatDuration(left.mins)} left`
  if (left.state === 'before') return Number.isFinite(left.mins) ? `in ${formatDuration(left.mins)}` : `at ${block.start}`
  return 'Ended'
}

export interface DayInput extends Refs {
  date: ISODate // today
  now: Date
  blocks: Block[] // the date's blocks
  tasks: Task[] // tasks dated today, any status
  logs: LogEntry[]
}

export type UpNext =
  // A block to work in now (current) or next. task: its first open task; none when only the
  // block's goal tick is left. goal/ticked: the goal the block serves and whether it's ticked.
  | { kind: 'block'; block: Block; current: boolean; task?: Task; goal?: Goal; ticked: boolean }
  // No block left with work, but tasks still open in blocks that have ended (M5 adds the prompt)
  | { kind: 'leftovers'; tasks: Task[] }
  | { kind: 'done' } // everything today is ticked
  | { kind: 'empty' } // nothing planned today

export function upNext(input: DayInput): UpNext {
  const { date, now, blocks, tasks, logs } = input
  const m = minutesOfDay(now)
  const open = blocks.filter((b) => !b.protected).sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  const work = (block: Block) => {
    const task = blockTasks(tasks, block, input).find(isOpen)
    const goal = servedGoal(block, input.goals)
    const ticked = blockTicked(block, logs)
    return { task, goal, ticked, has: !!task || (!!goal && !ticked) }
  }

  const current = open.find((b) => toMinutes(b.start) <= m && m < toMinutes(b.end))
  if (current) {
    const w = work(current)
    if (w.has) return { kind: 'block', block: current, current: true, ...w }
  }
  for (const b of open.filter((b) => toMinutes(b.start) > m)) {
    const w = work(b)
    if (w.has) return { kind: 'block', block: b, current: false, ...w }
  }

  const left = open.flatMap((b) => blockTasks(tasks, b, input).filter(isOpen))
  if (left.length) return { kind: 'leftovers', tasks: left }
  const planned = tasks.some((t) => t.date === date && (isOpen(t) || t.status === 'done'))
  const blockLogged = logs.some((l) => l.blockId && blocks.some((b) => b.id === l.blockId))
  return planned || blockLogged ? { kind: 'done' } : { kind: 'empty' }
}
