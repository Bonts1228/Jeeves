import { blockRoom } from '../db/blocks'
import type { Block, ID, Minutes, Task } from '../types'
import { isOverdueReason } from './brief'
import { blockTasks, type Refs, timeLeft } from './day'
import { toMinutes } from './time'
import { blockEnded } from './unfinished'

// Urgent capture (M6), as a pure function: a new task due today re-runs fill step 3 over today's
// remaining blocks. It goes in the first block of its area (any area if manual-only) that hasn't
// ended and has room. If none has, the first block where moving out its lowest-ranked tasks frees
// enough room. Moved tasks go to another remaining block with room (same area, within capacity),
// else back to the Backlog. Nothing is moved if the task can't go in anywhere.

export const ADDED_BY_YOU = 'Added by you'

export interface ReplanInput {
  task: Task // the urgent task: estimate, area
  anyArea: boolean // Housekeeping's own or manual-only: any area's block will do
  now: Date
  blocks: Block[] // today's blocks
  tasks: Task[] // today's tasks, any status
  capacity: Minutes // today's capacity setting
  refs: Refs // goals and projects, for the brief's rank order within a block
}

export interface Move {
  task: Task // as it was
  to: ID | null // another of today's blocks, or null: back to the Backlog
}

export type Replan =
  | { blockId: ID; moves: Move[] }
  | { blockId: null; why: 'no-block' | 'no-room' } // no remaining block of its area / none can make room

const byStart = (a: Block, b: Block) => toMinutes(a.start) - toMinutes(b.start)

// Tasks that may be moved out for an urgent one: open, ranked by the brief (not overdue or carried,
// not due today or earlier), not added by you, and not the current task of the block running now.
export function movable(block: Block, tasks: Task[], now: Date, refs: Refs): Task[] {
  const open = blockTasks(tasks, block, refs).filter((t) => t.status === 'scheduled')
  const running = timeLeft(block, now).state === 'during'
  return open.filter(
    (t, i) =>
      !(running && i === 0) &&
      t.reason !== ADDED_BY_YOU &&
      !isOverdueReason(t.reason) &&
      !(t.due && t.due <= block.date),
  )
}

export function replanUrgent({ task, anyArea, now, blocks, tasks, capacity, refs }: ReplanInput): Replan {
  const remaining = blocks
    .filter((b) => !b.protected && !blockEnded(b, now) && (anyArea || b.areaId === task.areaId))
    .sort(byStart)
  if (!remaining.length) return { blockId: null, why: 'no-block' }
  const scheduled = tasks.filter((t) => t.status === 'scheduled')

  const free = remaining.find((b) => blockRoom(b, scheduled, now) >= task.estimate)
  if (free) return { blockId: free.id, moves: [] }

  for (const block of remaining) {
    let room = blockRoom(block, scheduled, now)
    // Lowest-ranked first (the end of the block's order) until there's room...
    const out: Task[] = []
    for (const t of movable(block, tasks, now, refs).reverse()) {
      if (room >= task.estimate) break
      out.push(t)
      room += t.estimate
    }
    if (room < task.estimate) continue
    // ...then put back any taken early that turned out not to be needed (highest-ranked first)
    for (const t of [...out].reverse()) {
      if (room - t.estimate >= task.estimate) {
        out.splice(out.indexOf(t), 1)
        room -= t.estimate
      }
    }
    return { blockId: block.id, moves: rehome(out.reverse(), block, task, { now, blocks: remaining, tasks, capacity }) }
  }
  return { blockId: null, why: 'no-room' }
}

// Moved tasks (highest-ranked first) into another remaining block of their area with room, while
// the day stays within capacity; the rest go back to the Backlog. No rollover: the plan changed.
function rehome(
  out: Task[],
  from: Block,
  urgent: Task,
  { now, blocks, tasks, capacity }: { now: Date; blocks: Block[]; tasks: Task[]; capacity: Minutes },
): Move[] {
  const outIds = new Set(out.map((t) => t.id))
  // The day as it will be: the urgent task in, the moved ones out
  const placed: Task[] = [
    ...tasks.filter((t) => t.status === 'scheduled' && !outIds.has(t.id)),
    { ...urgent, status: 'scheduled', blockId: from.id },
  ]
  let used = [...placed, ...tasks.filter((t) => t.status === 'done')].reduce((sum, t) => sum + t.estimate, 0)
  return out.map((t) => {
    const to = blocks.find(
      (b) => b.id !== from.id && b.areaId === t.areaId && blockRoom(b, placed, now) >= t.estimate,
    )
    if (!to || used + t.estimate > capacity) return { task: t, to: null }
    placed.push({ ...t, blockId: to.id })
    used += t.estimate
    return { task: t, to: to.id }
  })
}
