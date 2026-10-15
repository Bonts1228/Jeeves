import { blockRoom } from '../db/blocks'
import type { Block, Goal, ID, ISODate, LogEntry, Task } from '../types'
import { blockTicked, servedGoal } from './block-goal'
import { isoDate, parseISODate } from './dates'
import { minutesOfDay, toMinutes } from './time'

// Unfinished and overdue (M5), as pure functions. Nothing here is stored: a task is unfinished or
// overdue because of its date, its block and the clock.

const byStart = (a: Block, b: Block) => toMinutes(a.start) - toMinutes(b.start)
const oldestFirst = (a: Task, b: Task) => a.createdAt.localeCompare(b.createdAt)

// A block is over once its end has passed (any block on an earlier day).
export function blockEnded(block: Block, now: Date): boolean {
  const today = isoDate(now)
  return block.date < today || (block.date === today && toMinutes(block.end) <= minutesOfDay(now))
}

// When a block ended, as a time: a block goal ticked after the fact is logged then.
export function blockEndAt(block: Block): Date {
  const d = parseISODate(block.date)
  d.setMinutes(toMinutes(block.end))
  return d
}

// Ids in the unfinished:<date> dismissed list for a block goal: closed on (Later), Skipped, or the
// session moved to another block (which asks in turn if it ends unticked).
export const goalPromptId = (blockId: ID) => `block:${blockId}`
export const skippedId = (blockId: ID) => `skipped:${blockId}`
export const movedId = (blockId: ID) => `moved:${blockId}`

export interface UnfinishedGroup {
  block?: Block // undefined: the block was deleted from the day
  tasks: Task[]
  goal?: Goal // the block's served goal, ended unticked and not skipped: "did you train?"
}

// Block goals to ask about: the goals, the logs (what's ticked) and the dismissed list (what's skipped).
export interface GoalCheck {
  goals: Goal[]
  logs: LogEntry[]
  dismissed: ID[]
}

// Open tasks on the date whose block has ended or no longer exists, grouped by block in time order
// (deleted block first: it can't be worked in at all). With check, an ended block whose served goal
// is unticked (and not skipped) is a group too, tasks or not.
export function unfinishedGroups(
  date: ISODate,
  tasks: Task[],
  blocks: Block[],
  now: Date,
  check?: GoalCheck,
): UnfinishedGroup[] {
  const open = tasks.filter((t) => t.status === 'scheduled' && t.date === date).sort(oldestFirst)
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const orphans = open.filter((t) => !byId.has(t.blockId!))
  const groups: UnfinishedGroup[] = orphans.length ? [{ tasks: orphans }] : []
  for (const block of [...blocks].sort(byStart)) {
    if (!blockEnded(block, now)) continue
    const mine = open.filter((t) => t.blockId === block.id)
    const served = check && !block.protected ? servedGoal(block, check.goals) : undefined
    const answered = check?.dismissed.includes(skippedId(block.id)) || check?.dismissed.includes(movedId(block.id))
    const goal = served && !blockTicked(block, check!.logs) && !answered ? served : undefined
    if (mine.length || goal) groups.push({ block, tasks: mine, ...(goal && { goal }) })
  }
  return groups
}

// What a group asks about, as ids for the dismissed list: its tasks, and its block goal.
export const promptIds = (groups: UnfinishedGroup[]): ID[] =>
  groups.flatMap((g) => [...(g.goal && g.block ? [goalPromptId(g.block.id)] : []), ...g.tasks.map((t) => t.id)])

export const unfinishedTasks = (date: ISODate, tasks: Task[], blocks: Block[], now: Date): Task[] =>
  unfinishedGroups(date, tasks, blocks, now).flatMap((g) => g.tasks)

// Overdue = scheduled on a day before today. Oldest day first.
export function overdueTasks(tasks: Task[], today: ISODate): Task[] {
  return tasks
    .filter((t) => t.status === 'scheduled' && t.date! < today)
    .sort((a, b) => a.date!.localeCompare(b.date!) || oldestFirst(a, b))
}

export interface NextBlockInput {
  task: Task
  anyArea: boolean // manual-only (Housekeeping): any area's block will do
  now: Date
  today: Block[] // today's blocks
  tomorrow: Block[] // tomorrow's blocks
  scheduled: Task[] // tasks scheduled today and tomorrow
}

// "Next block": the first block of the task's area (any area if anyArea) with room for its whole
// estimate that hasn't ended, today first, then tomorrow. Null if neither day has one.
export function nextBlockFor({ task, anyArea, now, today, tomorrow, scheduled }: NextBlockInput): Block | null {
  const others = scheduled.filter((t) => t.id !== task.id)
  const fits = (b: Block) =>
    !b.protected &&
    b.id !== task.blockId &&
    (anyArea || b.areaId === task.areaId) &&
    !blockEnded(b, now) &&
    blockRoom(b, others, now) >= task.estimate
  return [...today].sort(byStart).find(fits) ?? [...tomorrow].sort(byStart).find(fits) ?? null
}

export interface NextSessionInput {
  block: Block // the ended goal block
  now: Date
  today: Block[]
  tomorrow: Block[]
  logs: LogEntry[]
}

// "Move session": the next block of the same area that hasn't ended and isn't ticked yet, today
// first, then tomorrow. Null if neither day has one.
export function nextSessionFor({ block, now, today, tomorrow, logs }: NextSessionInput): Block | null {
  const fits = (b: Block) =>
    !b.protected && b.id !== block.id && b.areaId === block.areaId && !blockEnded(b, now) && !blockTicked(b, logs)
  return [...today].sort(byStart).find(fits) ?? [...tomorrow].sort(byStart).find(fits) ?? null
}
