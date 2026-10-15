import { describe, expect, it } from 'vitest'
import type { Block, Task } from '../types'
import { replanUrgent, type ReplanInput } from './replan'

const now = new Date(2026, 9, 15, 10) // Thu 15 Oct 2026, 10:00
const date = '2026-10-15'
const block = (id: string, start: string, end: string, extra: Partial<Block> = {}): Block => ({
  id,
  areaId: 'work',
  date,
  start,
  end,
  protected: false,
  ...extra,
})
let n = 0
const task = (id: string, estimate: number, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  estimate,
  areaId: 'work',
  status: 'scheduled',
  date,
  rollovers: 0,
  delegable: false,
  createdAt: new Date(2026, 9, 1, 0, n++).toISOString(),
  reason: 'Waiting since 1 Oct',
  ...extra,
})
const urgent = task('urgent', 60, { status: 'backlog', date: undefined, due: date })

const plan = (blocks: Block[], tasks: Task[], extra: Partial<ReplanInput> = {}) =>
  replanUrgent({ task: urgent, anyArea: false, now, blocks, tasks, capacity: 8 * 60, refs: { goals: [], projects: [] }, ...extra })

describe('urgent capture re-plan', () => {
  it('goes in the first remaining block of its area with room, moving nothing', () => {
    const blocks = [block('early', '07:00', '09:00'), block('am', '09:00', '11:00'), block('pm', '14:00', '17:00')]
    expect(plan(blocks, [task('a', 30, { blockId: 'am' })])).toEqual({ blockId: 'pm', moves: [] })
    expect(plan(blocks, [])).toEqual({ blockId: 'am', moves: [] }) // 60 min left of the running block
  })

  it('moves the lowest-ranked tasks out, never ticked, overdue, due, added-by-you or the current one', () => {
    const blocks = [block('pm', '14:00', '16:00')]
    const tasks = [
      task('overdue', 30, { blockId: 'pm', reason: 'Overdue from Tue' }),
      task('due', 30, { blockId: 'pm', due: date, reason: 'Due today' }),
      task('mine', 30, { blockId: 'pm', reason: 'Added by you' }),
      task('old', 15, { blockId: 'pm' }),
      task('young', 15, { blockId: 'pm' }),
      task('done', 30, { blockId: 'pm', status: 'done' }),
    ]
    // Room 0 → move the two tier-5 tasks (30 min), still short: no other movable task, so no room
    expect(plan(blocks, tasks, { task: { ...urgent, estimate: 60 } })).toEqual({ blockId: null, why: 'no-room' })
    expect(plan(blocks, tasks, { task: { ...urgent, estimate: 30 } })).toEqual({
      blockId: 'pm',
      moves: [
        { task: tasks[3], to: null },
        { task: tasks[4], to: null },
      ],
    })
  })

  it('moves only what it needs, lowest first, and never the current task of the running block', () => {
    const blocks = [block('am', '09:00', '11:00')] // running: 60 min left
    const tasks = [task('current', 30, { blockId: 'am' }), task('big', 30, { blockId: 'am' }), task('small', 15, { blockId: 'am' })]
    // Room 0 (75 min booked in 60): small then big go out → 45 free, still short of 60, current stays
    expect(plan(blocks, tasks)).toEqual({ blockId: null, why: 'no-room' })
    // Need 30: small (15) is not enough, big (30) is: put small back
    expect(plan(blocks, tasks, { task: { ...urgent, estimate: 30 } })).toMatchObject({
      blockId: 'am',
      moves: [{ task: { id: 'big' }, to: null }],
    })
  })

  it('a moved task goes to another remaining block with room, within capacity, else the Backlog', () => {
    const blocks = [block('am', '09:00', '11:00'), block('pm', '14:00', '15:00')]
    const tasks = [task('current', 30, { blockId: 'am' }), task('a', 30, { blockId: 'am' }), task('b', 30, { blockId: 'pm' })]
    // am can't make 60 (its current task stays), so pm moves b out, and b has nowhere else to go
    expect(plan(blocks, tasks, { task: { ...urgent, estimate: 60 } })).toEqual({ blockId: 'pm', moves: [{ task: tasks[2], to: null }] })
    const fill = plan(blocks, tasks, { task: { ...urgent, estimate: 30 } }) // am has 0 room, pm has 30
    expect(fill).toEqual({ blockId: 'pm', moves: [] })
    const tight = [...tasks, task('c', 30, { blockId: 'pm' })] // pm full too
    expect(plan(blocks, tight, { task: { ...urgent, estimate: 30 } })).toMatchObject({
      blockId: 'am',
      moves: [{ task: { id: 'a' }, to: null }], // nowhere with room
    })
    const later = [block('am', '09:00', '11:00'), block('pm', '14:00', '16:00')]
    const roomy = [task('current', 30, { blockId: 'am' }), task('a', 30, { blockId: 'am' }), task('b', 60, { blockId: 'pm' }), task('c', 30, { blockId: 'pm' })]
    expect(plan(later, roomy, { task: { ...urgent, estimate: 60 } })).toMatchObject({ blockId: 'pm', moves: [{ task: { id: 'c' } }] })
  })

  it('re-homes the higher-ranked moved task first, into a later block that has room for it', () => {
    const blocks = [block('am', '09:00', '11:00'), block('eve', '17:00', '17:20')]
    const tasks = [task('current', 30, { blockId: 'am' }), task('a', 20, { blockId: 'am' }), task('b', 10, { blockId: 'am' })]
    expect(plan(blocks, tasks, { task: { ...urgent, estimate: 30 } })).toEqual({
      blockId: 'am',
      moves: [
        { task: tasks[1], to: 'eve' },
        { task: tasks[2], to: null },
      ],
    })
  })

  it('stays within capacity when re-homing', () => {
    const blocks = [block('am', '09:00', '11:00'), block('eve', '17:00', '17:20')]
    const tasks = [task('current', 30, { blockId: 'am' }), task('a', 20, { blockId: 'am' }), task('b', 10, { blockId: 'am' })]
    // 30 current + 30 urgent = 60 used; a (20) would make 80 > 70, b (10) makes 70
    expect(plan(blocks, tasks, { task: { ...urgent, estimate: 30 }, capacity: 70 })).toMatchObject({
      moves: [
        { task: { id: 'a' }, to: null },
        { task: { id: 'b' }, to: 'eve' },
      ],
    })
  })

  it('skips ended, protected and other-area blocks; with none left it is no-block', () => {
    const blocks = [
      block('ended', '07:00', '09:00'),
      block('family', '18:00', '20:00', { protected: true }),
      block('gym', '17:00', '18:00', { areaId: 'gym' }),
    ]
    expect(plan(blocks, [])).toEqual({ blockId: null, why: 'no-block' })
    expect(plan(blocks, [], { anyArea: true })).toEqual({ blockId: 'gym', moves: [] }) // Housekeeping: any area
  })
})
