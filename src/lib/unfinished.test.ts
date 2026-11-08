import { describe, expect, it } from 'vitest'
import type { Block, Goal, LogEntry, Task } from '../types'
import {
  blockEndAt,
  blockEnded,
  type GoalCheck,
  goalPromptId,
  movedId,
  nextBlockFor,
  nextSessionFor,
  overdueTasks,
  promptIds,
  skippedId,
  unfinishedGroups,
  unfinishedTasks,
} from './unfinished'

// Thu 15 Oct 2026; tomorrow is Fri 16 Oct.
const THU = '2026-10-15'
const FRI = '2026-10-16'
const at = (h: number, m = 0) => new Date(2026, 9, 15, h, m)

const block = (id: string, start: string, end: string, extra: Partial<Block> = {}): Block => ({
  id,
  areaId: 'focus',
  date: THU,
  start,
  end,
  protected: false,
  ...extra,
})
const am = block('am', '08:00', '10:00')
const mid = block('mid', '10:00', '11:00')
const gym = block('gym', '11:00', '12:00', { areaId: 'gym' })
const lunch = block('lunch', '12:00', '13:00', { protected: true })
const pm = block('pm', '14:00', '16:00')
const thu = [pm, lunch, gym, mid, am]
const friAm = block('fri-am', '08:00', '12:00', { date: FRI })
const friGym = block('fri-gym', '17:00', '18:00', { date: FRI, areaId: 'gym' })

let n = 0
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  goalId: 'g-none', // no such goal row: not Housekeeping, so not manual-only
  title: id,
  estimate: 30,
  areaId: 'focus',
  status: 'scheduled',
  date: THU,
  blockId: 'am',
  rollovers: 0,
  delegable: false,
  createdAt: new Date(2026, 9, 1, 0, n++).toISOString(),
  ...extra,
})
const ids = (ts: Task[]) => ts.map((t) => t.id)

describe('blockEnded', () => {
  it('is past the end time today, and any block on an earlier day', () => {
    expect(blockEnded(am, at(9, 59))).toBe(false)
    expect(blockEnded(am, at(10))).toBe(true)
    expect(blockEnded(am, new Date(2026, 9, 16, 7))).toBe(true)
    expect(blockEnded(friAm, at(23))).toBe(false)
  })
})

describe('unfinishedGroups', () => {
  it("groups today's open tasks in ended blocks by block, in time order; done and future ones aren't", () => {
    const tasks = [
      task('m1', { blockId: 'mid' }),
      task('a2'),
      task('a1-done', { status: 'done' }),
      task('p1', { blockId: 'pm' }),
      task('a3'),
      task('fri', { date: FRI, blockId: 'fri-am' }),
    ]
    const groups = unfinishedGroups(THU, tasks, thu, at(11, 30))
    expect(groups.map((g) => [g.block?.id, ids(g.tasks)])).toEqual([
      ['am', ['a2', 'a3']],
      ['mid', ['m1']],
    ])
  })

  it('a task whose block was deleted is unfinished at once, listed first', () => {
    const tasks = [task('a1'), task('lost', { blockId: 'deleted' })]
    expect(unfinishedGroups(THU, tasks, thu, at(9)).map((g) => [g.block?.id, ids(g.tasks)])).toEqual([[undefined, ['lost']]])
    expect(ids(unfinishedTasks(THU, tasks, thu, at(10)))).toEqual(['lost', 'a1'])
  })
})

describe('block goals at block end', () => {
  const lifting: Goal = { id: 'lift', title: 'Lifting', type: 'recurring', areaId: 'gym', target: 4, period: 'week', servedByBlocks: true }
  const check = (extra: Partial<GoalCheck> = {}): GoalCheck => ({ goals: [lifting], logs: [], dismissed: [], ...extra })
  const tick: LogEntry = { id: 'l', goalId: 'lift', blockId: 'gym', completedAt: at(12).toISOString() }

  it('an ended, unticked goal block is a group even with no tasks; asked as block:<id>', () => {
    const groups = unfinishedGroups(THU, [], thu, at(12, 30), check())
    expect(groups.map((g) => [g.block?.id, g.goal?.id, g.tasks.length])).toEqual([['gym', 'lift', 0]])
    expect(promptIds(groups)).toEqual([goalPromptId('gym')])
  })

  it("comes with the block's open tasks, first in its ids", () => {
    const groups = unfinishedGroups(THU, [task('g1', { areaId: 'gym', blockId: 'gym' })], thu, at(12, 30), check())
    expect(promptIds(groups)).toEqual(['block:gym', 'g1'])
  })

  it("isn't asked before the block ends, once ticked, once skipped, or without a check", () => {
    expect(unfinishedGroups(THU, [], thu, at(11, 30), check())).toEqual([])
    expect(unfinishedGroups(THU, [], thu, at(12, 30), check({ logs: [tick] }))).toEqual([])
    expect(unfinishedGroups(THU, [], thu, at(12, 30), check({ dismissed: [skippedId('gym')] }))).toEqual([])
    expect(unfinishedGroups(THU, [], thu, at(12, 30))).toEqual([])
    // Later (closed on) still lists it: it just doesn't reopen the sheet
    expect(unfinishedGroups(THU, [], thu, at(12, 30), check({ dismissed: [goalPromptId('gym')] }))).toHaveLength(1)
  })

  it('a moved session stops asking for the ended block', () => {
    expect(unfinishedGroups(THU, [], thu, at(12, 30), check({ dismissed: [movedId('gym')] }))).toEqual([])
  })

  describe('nextSessionFor', () => {
    const gym2 = block('gym2', '17:00', '18:00', { areaId: 'gym' })
    const input = (extra: Partial<Parameters<typeof nextSessionFor>[0]> = {}) => ({
      block: gym,
      now: at(12, 30),
      today: [...thu, gym2],
      tomorrow: [friGym, friAm],
      logs: [],
      ...extra,
    })

    it("is the next same-area block today that hasn't ended or been ticked, else tomorrow's, else none", () => {
      expect(nextSessionFor(input())?.id).toBe('gym2')
      const ticked: LogEntry = { id: 'l2', goalId: 'lift', blockId: 'gym2', completedAt: at(12).toISOString() }
      expect(nextSessionFor(input({ logs: [ticked] }))?.id).toBe('fri-gym')
      expect(nextSessionFor(input({ now: at(18) }))?.id).toBe('fri-gym')
      expect(nextSessionFor(input({ tomorrow: [friAm], now: at(18) }))).toBeNull()
    })
  })

  it('blockEndAt is the block end on its day', () => {
    expect(blockEndAt(gym)).toEqual(at(12))
  })
})

describe('overdueTasks', () => {
  it('is scheduled on a day before today, oldest day first', () => {
    const tasks = [
      task('wed', { date: '2026-10-14' }),
      task('mon', { date: '2026-10-12' }),
      task('today'),
      task('done', { date: '2026-10-13', status: 'done' }),
      task('backlog', { date: undefined, status: 'backlog' }),
    ]
    expect(ids(overdueTasks(tasks, THU))).toEqual(['mon', 'wed'])
  })
})

describe('nextBlockFor', () => {
  const input = (t: Task, now: Date, scheduled: Task[] = [], anyArea = false) => ({
    task: t,
    anyArea,
    now,
    today: thu,
    tomorrow: [friGym, friAm],
    scheduled: [t, ...scheduled],
  })

  it('is the first later block of the same area with room today', () => {
    expect(nextBlockFor(input(task('a1'), at(10, 5)))?.id).toBe('mid')
    // mid is full: skip to pm (the protected lunch block never counts)
    const full = task('big', { blockId: 'mid', estimate: 60 })
    expect(nextBlockFor(input(task('a1'), at(10, 5), [full]))?.id).toBe('pm')
  })

  it("counts only the time left in a block that's running", () => {
    // 10:45: mid has 15 minutes left, too few for 30
    expect(nextBlockFor(input(task('a1'), at(10, 45)))?.id).toBe('pm')
  })

  it("then tomorrow's first block of the area, else none", () => {
    expect(nextBlockFor(input(task('p1', { blockId: 'pm' }), at(16)))?.id).toBe('fri-am')
    const g = task('g1', { areaId: 'gym', blockId: 'gym', estimate: 90 })
    expect(nextBlockFor(input(g, at(12)))).toBeNull()
  })

  it('a manual-only task may use any area', () => {
    const h = task('h1', { blockId: 'pm' })
    expect(nextBlockFor({ ...input(h, at(16)), tomorrow: [friGym] })).toBeNull()
    expect(nextBlockFor({ ...input(h, at(16), [], true), tomorrow: [friGym] })?.id).toBe('fri-gym')
  })
})
