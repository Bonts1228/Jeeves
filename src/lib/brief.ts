import { blockRoom } from '../db/blocks'
import {
  type Area,
  type Block,
  type Goal,
  HOUSEKEEPING_ID,
  type ID,
  type ISODate,
  type LogEntry,
  type Minutes,
  type Project,
  type Repeat,
  type Settings,
  type Task,
} from '../types'
import { addDays, dayMonth, isoDate, parseISODate, weekdayOf } from './dates'
import { isHeldBack } from './holdback'
import { expectedBy, periodStart } from './progress'
import { blockEnded } from './unfinished'
import { blockMinutes, formatDuration, toMinutes, WEEKDAY_SHORT } from './time'

// Brief rules v0 (CLAUDE.md), as a pure function: rank candidate tasks, then fill the date's blocks
// in time order up to capacity. The db layer (db/brief.ts) reads the inputs and saves the placements.

export interface BriefInput {
  date: ISODate // the day being planned, usually tomorrow
  now: Date
  settings: Settings
  areas: Area[]
  goals: Goal[]
  projects: Project[]
  tasks: Task[] // open tasks (backlog and scheduled), any date
  logs: LogEntry[]
  blocks: Block[] // the date's blocks
  todayBlocks?: Block[] // today's blocks, when planning a later day: which of today's tasks are left
  removed?: ID[] // taken out at review: never placed again for this date
}

// 1 overdue, 2 due, 3 behind pace, 4 next step, 5 everything else
export type Tier = 1 | 2 | 3 | 4 | 5

export interface Placement {
  task: Task
  blockId: ID
  reason: string
  tier: Tier
}

// A tier 1–4 candidate that didn't go in, and why. Tier 5 leftovers are just the Backlog.
export interface NotPlaced {
  task: Task
  reason: string
  why: string
}

export interface Brief {
  placements: Placement[]
  notPlaced: NotPlaced[]
  cap: Minutes // the lower of the day's capacity and its block time
  used: Minutes // scheduled minutes on the date, placements included
}

interface Candidate {
  task: Task
  reason: string
  tier: Tier
}

// "Tue" within the week before the date, else "2 Oct".
function shortDay(date: ISODate, from: ISODate): string {
  if (date <= from && date > addDays(from, -7)) return WEEKDAY_SHORT[weekdayOf(date)]
  return dayMonth(date)
}

// The reasons rule 2.1 gives. A placed task keeps its reason, so the day view can still tell it was
// overdue when the brief ranked it (lib/day.ts orders a block's tasks by the brief's tiers).
const CARRIED = 'Carried from today'
const OVERDUE = 'Overdue from '
export const isOverdueReason = (reason?: string) => reason === CARRIED || !!reason?.startsWith(OVERDUE)
export const isCarriedReason = (reason?: string) => reason === CARRIED
// A project's later step placed by rule 2.5 ("CFA: step 3"), not as its next step (rule 2.4)
const laterStep = (title: string, order: number) => `${title}: step ${order}`
export const isLaterStepReason = (reason?: string) => !!reason && /: step \d+$/.test(reason)

export const cadence = (r: Repeat) => (r.kind === 'weekly' ? 'weekly' : `every ${r.days} day${r.days === 1 ? '' : 's'}`)

const byOrder = (a: Task, b: Task) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt.localeCompare(b.createdAt)
const oldestFirst = (a: Task, b: Task) => a.createdAt.localeCompare(b.createdAt)

// Manual-only: a manual-only project's tasks. They come in only as due or overdue (or added by hand).
export function isManualTask(task: Pick<Task, 'projectId'>, projects: Project[]): boolean {
  return !!task.projectId && !!projects.find((p) => p.id === task.projectId)?.manualOnly
}

// Tasks with no real area: manual-only ones and Housekeeping's own. They may use any area's block.
export function isAnyAreaTask(task: Pick<Task, 'goalId' | 'projectId'>, projects: Project[]): boolean {
  return isManualTask(task, projects) || (!task.projectId && task.goalId === HOUSEKEEPING_ID)
}

// Oldest first, except a project's ordered steps keep their suggested order among themselves: they
// all sort where the project's oldest one would. A soft preference: later steps aren't held back.
export function softOrder(tasks: Task[]) {
  const start = new Map<ID, string>()
  for (const t of tasks) {
    if (!t.projectId || t.order === undefined) continue
    const oldest = start.get(t.projectId)
    if (!oldest || t.createdAt < oldest) start.set(t.projectId, t.createdAt)
  }
  const isStep = (t: Task) => !!t.projectId && t.order !== undefined
  const key = (t: Task) => (isStep(t) ? start.get(t.projectId!)! : t.createdAt)
  return (a: Task, b: Task) => {
    const byKey = key(a).localeCompare(key(b))
    if (byKey || !isStep(a) || !isStep(b)) return byKey || oldestFirst(a, b)
    if (a.projectId !== b.projectId) return a.projectId!.localeCompare(b.projectId!)
    return a.order! - b.order!
  }
}

export function rankCandidates(input: BriefInput): Candidate[] {
  const { date, now, goals, projects, tasks, logs } = input
  const today = isoDate(now)
  const isManual = (t: Task) => isManualTask(t, projects)
  // Held-back projects (not before a later date, or waiting on another project) only come in as
  // overdue or due (rules 2.1–2.2)
  const held = new Set(projects.filter((p) => isHeldBack(p, date)).map((p) => p.id))
  const isHeld = (t: Task) => !!t.projectId && held.has(t.projectId)
  const backlog = tasks.filter((t) => t.status === 'backlog')
  const soft = softOrder(backlog)
  const out: Candidate[] = []
  const seen = new Set<ID>()
  const add = (task: Task, reason: string, tier: Tier) => {
    if (seen.has(task.id)) return
    seen.add(task.id)
    out.push({ task, reason, tier })
  }

  // 1. Overdue: scheduled before the date. The brief runs the evening before, so today's leftovers
  // count: tasks whose block has ended or is gone. Tasks in today's blocks still to come stay put.
  const todayBlocks = new Map((input.todayBlocks ?? []).map((b) => [b.id, b]))
  const leftToday = (t: Task) => {
    const block = todayBlocks.get(t.blockId!)
    return !block || blockEnded(block, now)
  }
  tasks
    .filter((t) => t.status === 'scheduled' && t.date! < date && (t.date !== today || leftToday(t)))
    .sort((a, b) => a.date!.localeCompare(b.date!) || oldestFirst(a, b))
    .forEach((t) => add(t, t.date === today ? CARRIED : `${OVERDUE}${shortDay(t.date!, today)}`, 1))

  // 2. Due by the date, earliest first. Repeating tasks show their cadence.
  backlog
    .filter((t) => t.due && t.due <= date)
    .sort((a, b) => a.due!.localeCompare(b.due!) || oldestFirst(a, b))
    .forEach((t) => add(t, [`Due ${shortDay(t.due!, date)}`, t.repeat && cadence(t.repeat)].filter(Boolean).join(' · '), 2))

  // 3. Recurring count goals behind pace. Block-served goals are served by their blocks, not tasks.
  const end = addDays(date, 1)
  for (const g of goals) {
    if (g.type !== 'recurring' || g.servedByBlocks || !g.target || !g.period) continue
    const start = periodStart(g.period, parseISODate(date))
    const expected = expectedBy(g.target, g.period, date)
    const logged = logs.filter(
      (l) => l.goalId === g.id && l.completedAt >= start.toISOString() && l.completedAt < parseISODate(end).toISOString(),
    ).length
    const scheduled = tasks.filter(
      (t) => t.goalId === g.id && t.status === 'scheduled' && t.date! >= isoDate(start) && t.date! <= date,
    ).length
    const need = expected - logged - scheduled
    if (need <= 0) continue
    const left = g.target - logged - scheduled
    backlog
      .filter((t) => t.goalId === g.id && !isManual(t) && !isHeld(t) && !t.repeat)
      .sort(soft)
      .slice(0, need)
      .forEach((t) => add(t, `${left} left this ${g.period}`, 3))
  }

  // 4. Next step of each (non-manual) project, by suggested order: the first open step still in the
  // Backlog. One step per project per day: a project with a step already on the date adds nothing.
  const goalById = new Map(goals.map((g) => [g.id, g]))
  const paths = projects
    .filter((p) => !p.manualOnly && !held.has(p.id))
    .map((p) => ({ title: p.title, deadline: goalById.get(p.goalId)?.deadline, steps: tasks.filter((t) => t.projectId === p.id) }))
    .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.title.localeCompare(b.title))
  for (const path of paths) {
    if (path.steps.some((t) => t.status === 'scheduled' && t.date === date)) continue
    const next = path.steps.filter((t) => t.status === 'backlog').sort(byOrder)[0]
    if (next) add(next, `${path.title}: next step`, 4)
  }

  // 5. Everything else, oldest first; a project's later steps in their suggested order (never a gate).
  // Not manual-only, held-back or repeating tasks: they come in only as due or overdue.
  const projectTitle = new Map(projects.map((p) => [p.id, p.title]))
  backlog
    .filter((t) => !isManual(t) && !isHeld(t) && !t.repeat)
    .sort(soft)
    .forEach((t) =>
      add(
        t,
        t.projectId && t.order !== undefined
          ? laterStep(projectTitle.get(t.projectId) ?? 'Project', t.order)
          : `Waiting since ${shortDay(isoDate(new Date(t.createdAt)), date)}`,
        5,
      ),
    )

  return out
}

export function buildBrief(input: BriefInput): Brief {
  const { date, now, settings, areas, projects, tasks, blocks } = input
  const removed = new Set(input.removed)
  const open = blocks.filter((b) => !b.protected).sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  const scheduledOnDate = tasks.filter((t) => t.status === 'scheduled' && t.date === date)
  const room = new Map(open.map((b) => [b.id, blockRoom(b, scheduledOnDate, now)]))
  const cap = Math.min(settings.capacity[weekdayOf(date)], open.reduce((sum, b) => sum + blockMinutes(b), 0))
  let used = scheduledOnDate.reduce((sum, t) => sum + t.estimate, 0)
  const areaName = (id: ID) => areas.find((a) => a.id === id)?.name ?? 'area'
  const day = WEEKDAY_SHORT[weekdayOf(date)]

  const placements: Placement[] = []
  const notPlaced: NotPlaced[] = []
  for (const { task, reason, tier } of rankCandidates(input)) {
    if (removed.has(task.id)) continue
    // Housekeeping's own and manual-only tasks may use any area's block; everything else only its own area's.
    const anyArea = isAnyAreaTask(task, projects)
    const eligible = open.filter((b) => anyArea || b.areaId === task.areaId)
    const block = eligible.find((b) => room.get(b.id)! >= task.estimate)
    let why: string | null = null
    if (!eligible.length) why = `No ${areaName(task.areaId)} block ${day}`
    else if (used + task.estimate > cap) why = `Over ${formatDuration(cap)} capacity`
    else if (!block) why = `No block with ${formatDuration(task.estimate)} free`

    if (why || !block) {
      if (tier < 5) notPlaced.push({ task, reason, why: why! })
      continue
    }
    room.set(block.id, room.get(block.id)! - task.estimate)
    used += task.estimate
    placements.push({ task, blockId: block.id, reason, tier })
  }
  return { placements, notPlaced, cap, used }
}
