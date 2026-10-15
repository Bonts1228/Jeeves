import { describe, expect, it } from 'vitest'
import type { Block, Goal, LogEntry, Project, Settings, Task } from '../types'
import { buildBrief } from './brief'
import { blockGoal, blockTasks, canQuickAdd, type DayInput, timeLeft, upNext, whenLabel } from './day'

// Thu 15 Oct 2026. The brief was built on Wed 14 Oct at 21:00.
const THU = '2026-10-15'
const at = (h: number, m = 0) => new Date(2026, 9, 15, h, m)

const settings: Settings = { briefTime: '21:00', capacity: { 0: 180, 1: 540, 2: 540, 3: 540, 4: 540, 5: 420, 6: 180 } }
const areas = [
  { id: 'focus', name: 'Focus' },
  { id: 'gym', name: 'Gym' },
  { id: 'family', name: 'Family' },
]
const block = (id: string, start: string, end: string, extra: Partial<Block> = {}): Block => ({
  id,
  areaId: 'focus',
  date: THU,
  start,
  end,
  protected: false,
  ...extra,
})
const am = block('am', '08:00', '12:00')
const lunch = block('lunch', '12:00', '13:00', { areaId: 'family', protected: true })
const gym = block('gym', '17:30', '19:00', { areaId: 'gym' })
const eve = block('eve', '20:00', '22:00')
const blocks = [eve, gym, lunch, am]

let n = 0
const task = (title: string, extra: Partial<Task> = {}): Task => ({
  id: title,
  title,
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

const lifting: Goal = { id: 'lift', title: 'Lifting', type: 'recurring', areaId: 'gym', target: 5, period: 'week', servedByBlocks: true }
const outreach: Goal = { id: 'out', title: 'Outreach', type: 'recurring', areaId: 'focus', target: 5, period: 'week' }
const jeeves: Goal = { id: 'jeeves', title: 'Launch Jeeves', type: 'set_path', areaId: 'focus', deadline: '2026-12-31' }
const job: Goal = { id: 'job', title: 'Secure a job', type: 'open_path', areaId: 'focus', deadline: '2026-11-30' }
const setup: Project = { id: 'setup', title: 'Job search setup', areaId: 'focus', goalId: 'job' }
const house: Project = { id: 'house', title: 'Housekeeping', areaId: 'focus', manualOnly: true }
const goals = [lifting, outreach, jeeves, job]
const projects = [setup, house]
const refs = { goals, projects }

const ids = (ts: Task[]) => ts.map((t) => t.id)

describe('blockTasks', () => {
  it("gives a block's tasks in the order the brief ranked them", () => {
    // One of each tier, in the Backlog (or left over) on Wed evening, all fitting in the morning block
    const backlog = (title: string, extra: Partial<Task> = {}) =>
      task(title, { status: 'backlog', date: undefined, blockId: undefined, ...extra })
    const tasks = [
      backlog('loose old'),
      backlog('jeeves step 2', { goalId: 'jeeves', order: 2 }),
      backlog('jeeves step 1', { goalId: 'jeeves', order: 1 }),
      backlog('setup step 1', { projectId: 'setup', order: 1 }),
      backlog('outreach'),
      backlog('due thu', { due: THU }),
      backlog('due wed', { due: '2026-10-14' }),
      backlog('left today', { status: 'scheduled', date: '2026-10-14', blockId: 'wed-am' }),
      backlog('left mon', { status: 'scheduled', date: '2026-10-12', blockId: 'mon-am' }),
    ]
    tasks.find((t) => t.id === 'outreach')!.goalId = 'out'
    const brief = buildBrief({
      date: THU,
      now: new Date(2026, 9, 14, 21),
      settings,
      areas,
      goals,
      projects,
      tasks,
      logs: [],
      blocks: [am],
    })
    const ranked = brief.placements.map((p) => p.task.id)
    expect(ranked).toEqual([
      'left mon',
      'left today',
      'due wed',
      'due thu',
      'outreach',
      'setup step 1', // Job search setup feeds a goal due 30 Nov, before Jeeves's 31 Dec
      'jeeves step 1',
      'loose old',
    ])

    // As saved by fillBrief, shuffled; done ones go after the open ones
    const placed = brief.placements
      .map((p): Task => ({ ...p.task, status: 'scheduled', date: THU, blockId: p.blockId, reason: p.reason }))
      .reverse()
    expect(ids(blockTasks(placed, am, refs))).toEqual(ranked)
    placed.find((t) => t.id === 'left mon')!.status = 'done'
    expect(ids(blockTasks(placed, am, refs))).toEqual([...ranked.slice(1), 'left mon'])
  })

  it('keeps steps of one path in their order and leaves other blocks and deleted tasks out', () => {
    const tasks = [
      task('step 3', { goalId: 'jeeves', order: 3 }),
      task('step 2', { goalId: 'jeeves', order: 2 }),
      task('gone', { status: 'deleted' }),
      task('elsewhere', { blockId: 'eve' }),
    ]
    expect(ids(blockTasks(tasks, am, refs))).toEqual(['step 2', 'step 3'])
  })
})

describe('timeLeft', () => {
  it('is wall clock to the block end', () => {
    expect(timeLeft(am, at(7, 40))).toEqual({ state: 'before', mins: 20 })
    expect(timeLeft(am, at(10, 15))).toEqual({ state: 'during', mins: 105 })
    expect(timeLeft(am, at(12))).toEqual({ state: 'after' })
    expect(timeLeft(am, new Date(2026, 9, 16, 9))).toEqual({ state: 'after' })
  })
})

describe('upNext', () => {
  const day = (now: Date, tasks: Task[], logs: LogEntry[] = []): DayInput => ({
    date: THU,
    now,
    blocks,
    tasks,
    logs,
    ...refs,
  })
  const tickGym: LogEntry = { id: 'l1', goalId: 'lift', blockId: 'gym', completedAt: at(18).toISOString() }
  const tasks = () => [task('a1'), task('a2'), task('e1', { blockId: 'eve' })]

  it('during a block: that block and its first open task', () => {
    expect(upNext(day(at(9), tasks()))).toMatchObject({ kind: 'block', block: am, current: true, task: { id: 'a1' } })
    const ts = tasks()
    ts[0].status = 'done' // ticked out of order doesn't matter: the first open one is current
    expect(upNext(day(at(9), ts))).toMatchObject({ kind: 'block', block: am, task: { id: 'a2' } })
  })

  it('before the first block: the first block with work', () => {
    expect(upNext(day(at(6), tasks()))).toMatchObject({ kind: 'block', block: am, current: false, task: { id: 'a1' } })
  })

  it('between blocks, or in a block with nothing open: the next block with work, skipping protected ones', () => {
    // 12:30 is in the protected lunch block; the Gym block has only its goal tick
    const next = upNext(day(at(12, 30), tasks()))
    expect(next).toMatchObject({ kind: 'block', block: gym, current: false, goal: lifting, ticked: false })
    expect(next.kind === 'block' && next.task).toBeFalsy()
    // Gym ticked early: on to the evening block
    expect(upNext(day(at(17, 45), tasks(), [tickGym]))).toMatchObject({ kind: 'block', block: eve, current: false, task: { id: 'e1' } })
  })

  it('an empty block with an unticked block goal is up next while it runs', () => {
    expect(upNext(day(at(18), tasks()))).toMatchObject({ kind: 'block', block: gym, current: true, goal: lifting, ticked: false })
  })

  it('after the last block: everything the Unfinished sheet would ask, else done', () => {
    // Open tasks in ended or deleted blocks, plus the Gym block that ended unticked
    const left = upNext(day(at(22, 30), [...tasks(), task('lost', { blockId: 'deleted' })]))
    expect(left).toEqual({ kind: 'unfinished', count: 5 })
    const all = tasks().map((t) => ({ ...t, status: 'done' as const }))
    expect(upNext(day(at(22, 30), all, [tickGym]))).toEqual({ kind: 'done' })
  })

  it("an unticked block goal alone is unfinished, not done, until it's ticked or skipped", () => {
    const all = tasks().map((t) => ({ ...t, status: 'done' as const }))
    expect(upNext(day(at(22, 30), all))).toEqual({ kind: 'unfinished', count: 1 })
    // Later (closed on) still counts; Skipped doesn't
    expect(upNext({ ...day(at(22, 30), all), dismissed: ['block:gym'] })).toEqual({ kind: 'unfinished', count: 1 })
    expect(upNext({ ...day(at(22, 30), all), dismissed: ['skipped:gym'] })).toEqual({ kind: 'done' })
  })

  it('nothing planned: empty, unless a block goal was ticked (or is still to answer)', () => {
    expect(upNext({ ...day(at(22, 30), []), dismissed: ['skipped:gym'] })).toEqual({ kind: 'empty' })
    expect(upNext(day(at(22, 30), [], [tickGym]))).toEqual({ kind: 'done' })
    expect(upNext(day(at(22, 30), []))).toEqual({ kind: 'unfinished', count: 1 })
  })
})

describe('blockGoal', () => {
  it("is the block's served goal, else the current task's goal (or its project's)", () => {
    expect(blockGoal(gym, task('x', { goalId: 'jeeves' }), refs)).toBe(lifting)
    expect(blockGoal(am, task('x', { goalId: 'jeeves' }), refs)).toBe(jeeves)
    expect(blockGoal(am, task('x', { projectId: 'setup' }), refs)).toBe(job)
    expect(blockGoal(am, task('x', { projectId: 'house' }), refs)).toBeUndefined()
    expect(blockGoal(am, undefined, refs)).toBeUndefined()
  })
})

describe('canQuickAdd', () => {
  it("is any of today's non-protected blocks until it ends: running or still to come, template or one-off", () => {
    const oneOff = block('one-off', '14:00', '14:30') // no templateId, as made in Edit blocks
    expect(canQuickAdd(oneOff, at(13))).toBe(true) // not started yet
    expect(canQuickAdd(oneOff, at(14, 10))).toBe(true) // running
    expect(canQuickAdd(oneOff, at(14, 30))).toBe(false) // ended
    expect(canQuickAdd({ ...am, templateId: 'tpl' }, at(9))).toBe(true)
    expect(canQuickAdd(lunch, at(12, 30))).toBe(false) // protected
    expect(canQuickAdd(eve, new Date(2026, 9, 14, 21))).toBe(false) // not today (tomorrow's block)
  })
})

describe('whenLabel', () => {
  it('reads time left, time to start, or ended', () => {
    expect(whenLabel(am, at(7, 40))).toBe('in 20m')
    expect(whenLabel(am, at(10, 40))).toBe('1h 20m left')
    expect(whenLabel(am, at(12))).toBe('Ended')
  })
})
