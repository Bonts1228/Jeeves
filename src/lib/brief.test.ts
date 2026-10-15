import { describe, expect, it } from 'vitest'
import type { Block, Goal, LogEntry, Project, Settings, Task } from '../types'
import { type BriefInput, buildBrief, rankCandidates } from './brief'

// Brief for Thu 15 Oct 2026, built on Wed 14 Oct at 21:00.
const WED = '2026-10-14'
const THU = '2026-10-15'
const now = new Date(2026, 9, 14, 21)

const settings: Settings = { briefTime: '21:00', capacity: { 0: 180, 1: 540, 2: 540, 3: 540, 4: 540, 5: 420, 6: 180 } }
const areas = [
  { id: 'focus', name: 'Focus' },
  { id: 'gym', name: 'Gym' },
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
const thuBlocks = [block('pm', '13:30', '16:30'), block('am', '08:00', '12:00'), block('eve', '20:00', '22:00')]

let n = 0
const task = (title: string, extra: Partial<Task> = {}): Task => ({
  id: title,
  title,
  estimate: 30,
  areaId: 'focus',
  status: 'backlog',
  rollovers: 0,
  delegable: false,
  createdAt: new Date(2026, 9, 1, 0, n++).toISOString(),
  ...extra,
})

const housekeeping: Project = { id: 'house', title: 'Housekeeping', areaId: 'focus', manualOnly: true }

const input = (extra: Partial<BriefInput>): BriefInput => ({
  date: THU,
  now,
  settings,
  areas,
  goals: [],
  projects: [housekeeping],
  tasks: [],
  logs: [],
  blocks: thuBlocks,
  ...extra,
})

const placed = (i: BriefInput) => buildBrief(i).placements.map((p) => [p.task.id, p.blockId, p.reason])
const reasons = (i: BriefInput) => rankCandidates(i).map((c) => [c.task.id, c.reason, c.tier])

describe('rankCandidates', () => {
  it('ranks overdue, then due, then next steps, then everything else', () => {
    const goal: Goal = { id: 'g', title: 'Launch Jeeves', type: 'set_path', areaId: 'focus' }
    const tasks = [
      task('old loose'),
      task('step 2', { goalId: 'g', order: 2 }),
      task('step 1', { goalId: 'g', order: 1 }),
      task('due thu', { due: THU }),
      task('left mon', { status: 'scheduled', date: '2026-10-12', blockId: 'x' }),
      task('left today', { status: 'scheduled', date: WED, blockId: 'y' }),
    ]
    expect(reasons(input({ goals: [goal], tasks }))).toEqual([
      ['left mon', 'Overdue from Mon', 1],
      ['left today', 'Carried from today', 1],
      ['due thu', 'Due Thu', 2],
      ['step 1', 'Launch Jeeves: next step', 4],
      ['old loose', 'Waiting since 1 Oct', 5],
    ])
  })

  it('shows the cadence of a due repeating task, and leaves repeating and manual-only tasks out otherwise', () => {
    const tasks = [
      task('meal plan', { projectId: 'house', due: THU, repeat: { kind: 'weekly', weekday: 4 } }),
      task('laundry', { projectId: 'house', due: '2026-10-13', repeat: { kind: 'every', days: 8 } }),
      task('later laundry', { due: '2026-10-20', repeat: { kind: 'every', days: 8 } }),
      task('clean flat', { projectId: 'house' }),
    ]
    expect(reasons(input({ tasks }))).toEqual([
      ['laundry', 'Due Tue · every 8 days', 2],
      ['meal plan', 'Due Thu · weekly', 2],
    ])
  })

  it('lists each task once, in its highest tier', () => {
    const goal: Goal = { id: 'g', title: 'CFA', type: 'set_path', areaId: 'focus' }
    const tasks = [task('unit 1', { goalId: 'g', order: 1, due: THU })]
    expect(reasons(input({ goals: [goal], tasks }))).toEqual([['unit 1', 'Due Thu', 2]])
  })

  it('takes the first step still in the Backlog: done and scheduled steps before it do not block it', () => {
    const goal: Goal = { id: 'g', title: 'CFA', type: 'set_path', areaId: 'focus' }
    const project: Project = { id: 'p', title: 'Job setup', areaId: 'focus', goalId: 'g2' }
    const tasks = [
      task('u1', { goalId: 'g', order: 1, status: 'done' }),
      task('u2', { goalId: 'g', order: 2, status: 'scheduled', date: WED, blockId: 'am' }),
      task('u3', { goalId: 'g', order: 3 }),
      task('u4', { goalId: 'g', order: 4 }),
      task('cv', { projectId: 'p', order: 1 }),
    ]
    const goals: Goal[] = [goal, { id: 'g2', title: 'Job', type: 'open_path', areaId: 'focus', deadline: '2026-11-01' }]
    // Job setup inherits its goal's deadline, so it comes before CFA (no deadline)
    expect(reasons(input({ goals, projects: [housekeeping, project], tasks }))).toEqual([
      ['u2', 'Carried from today', 1],
      ['cv', 'Job setup: next step', 4],
      ['u3', 'CFA: next step', 4],
    ])
  })

  it('adds one step per path per day: a path with a step already on the date waits', () => {
    const goal: Goal = { id: 'g', title: 'CFA', type: 'set_path', areaId: 'focus' }
    const tasks = [
      task('u1', { goalId: 'g', order: 1, status: 'scheduled', date: THU, blockId: 'am' }),
      task('u2', { goalId: 'g', order: 2 }),
    ]
    expect(reasons(input({ goals: [goal], tasks }))).toEqual([])
  })

  it('leaves held-back projects out of rules 2.3–2.5, but their due and overdue steps still rank', () => {
    const goals: Goal[] = [{ id: 'r', title: 'Run', type: 'recurring', areaId: 'focus', target: 7, period: 'week' }]
    const projects: Project[] = [
      housekeeping,
      { id: 'wait', title: 'Portfolio', areaId: 'focus', startsAfterProjectId: 'other' },
      { id: 'soon', title: 'Garden', areaId: 'focus', notBefore: '2026-10-16' },
      { id: 'now', title: 'Shed', areaId: 'focus', notBefore: THU },
    ]
    const tasks = [
      task('wait 1', { projectId: 'wait', order: 1 }),
      task('wait due', { projectId: 'wait', order: 2, due: THU }),
      task('wait late', { projectId: 'wait', order: 3, status: 'scheduled', date: '2026-10-12', blockId: 'x' }),
      task('wait run', { projectId: 'soon', goalId: 'r', order: 1 }),
      task('shed 1', { projectId: 'now', order: 1 }),
    ]
    expect(reasons(input({ goals, projects, tasks }))).toEqual([
      ['wait late', 'Overdue from Mon', 1],
      ['wait due', 'Due Thu', 2],
      ['shed 1', 'Shed: next step', 4],
    ])
  })

  describe('recurring goals behind pace', () => {
    // Thu is day 4 of the week: 5 a week → 3 expected by end of Thu
    const goal: Goal = { id: 'r', title: 'Run', type: 'recurring', areaId: 'focus', target: 5, period: 'week' }
    const runs = Array.from({ length: 4 }, (_, i) => task(`run ${i + 1}`, { goalId: 'r' }))
    const log = (day: number): LogEntry => ({ id: `l${day}`, goalId: 'r', completedAt: new Date(2026, 9, day, 9).toISOString() })

    it('places enough to catch up to pace, with how many are left', () => {
      expect(reasons(input({ goals: [goal], tasks: runs, logs: [log(12)] }))).toEqual([
        ['run 1', '4 left this week', 3],
        ['run 2', '4 left this week', 3],
        ['run 3', 'Waiting since 1 Oct', 5],
        ['run 4', 'Waiting since 1 Oct', 5],
      ])
    })

    it('counts scheduled tasks and ignores last week', () => {
      const tasks = [...runs, task('run sched', { goalId: 'r', status: 'scheduled', date: WED, blockId: 'b' })]
      const logs = [log(5), log(6), log(12)] // 5 and 6 Oct are last week
      expect(reasons(input({ goals: [goal], tasks, logs })).filter((r) => r[2] === 3)).toEqual([
        ['run 1', '3 left this week', 3],
      ])
    })

    it('is on pace with nothing to add', () => {
      const logs = [log(12), log(13), log(14)]
      expect(reasons(input({ goals: [goal], tasks: runs, logs })).filter((r) => r[2] === 3)).toEqual([])
    })

    it('starts a fresh week on Monday', () => {
      // Mon 19 Oct is day 1: ceil(5/7) = 1 expected, last week's logs don't count
      const logs = [log(12), log(13), log(14), log(15), log(16)]
      const mon = input({ date: '2026-10-19', goals: [goal], tasks: runs, logs, blocks: [] })
      expect(reasons(mon).filter((r) => r[2] === 3)).toEqual([['run 1', '5 left this week', 3]])
    })

    it('paces a month by its days', () => {
      // 15 of 31 days: ceil(10 × 15 / 31) = 5 expected
      const monthly = { ...goal, target: 10, period: 'month' as const }
      const many = Array.from({ length: 8 }, (_, i) => task(`m${i}`, { goalId: 'r' }))
      expect(reasons(input({ goals: [monthly], tasks: many, logs: [log(2), log(3)] })).filter((r) => r[2] === 3)).toHaveLength(3)
    })

    it('leaves block-served goals to their blocks', () => {
      const served = { ...goal, servedByBlocks: true }
      expect(reasons(input({ goals: [served], tasks: runs })).filter((r) => r[2] === 3)).toEqual([])
    })
  })
})

describe('buildBrief', () => {
  it('fills blocks in time order, first block with room, never splitting', () => {
    const tasks = [task('a', { estimate: 200 }), task('b', { estimate: 60 }), task('c', { estimate: 30 })]
    expect(placed(input({ tasks }))).toEqual([
      ['a', 'am', 'Waiting since 1 Oct'],
      ['b', 'pm', 'Waiting since 1 Oct'], // 40m left in am: b doesn't fit there
      ['c', 'am', 'Waiting since 1 Oct'],
    ])
  })

  it('skips a task whose area has no block that day: no capacity used, listed as not placed', () => {
    const gymBlocks = [...thuBlocks, block('gym', '17:30', '19:00', { areaId: 'gym', protected: true })]
    const tasks = [task('mobility', { areaId: 'gym', due: THU }), task('write', { estimate: 60 })]
    const brief = buildBrief(input({ tasks, blocks: gymBlocks }))
    expect(brief.placements.map((p) => p.task.id)).toEqual(['write'])
    expect(brief.used).toBe(60)
    expect(brief.notPlaced.map((p) => [p.task.id, p.reason, p.why])).toEqual([['mobility', 'Due Thu', 'No Gym block Thu']])
  })

  it('stops at the lower of capacity and block time, skipping what would go over and keeping on', () => {
    const tasks = [task('big', { estimate: 90, due: THU }), task('small', { estimate: 30 })]
    const low = { ...settings, capacity: { ...settings.capacity, 4: 60 } }
    const brief = buildBrief(input({ settings: low, tasks }))
    expect(brief.cap).toBe(60)
    expect(brief.placements.map((p) => p.task.id)).toEqual(['small'])
    expect(brief.notPlaced.map((p) => p.why)).toEqual(['Over 1h capacity'])

    const short = buildBrief(input({ tasks, blocks: [block('am', '08:00', '09:00')] }))
    expect(short.cap).toBe(60)
  })

  it('reports a task too big for any block', () => {
    const brief = buildBrief(input({ tasks: [task('epic', { estimate: 300, due: THU })] }))
    expect(brief.notPlaced.map((p) => p.why)).toEqual(['No block with 5h free'])
  })

  it('puts due manual-only tasks in the first block of any area with room', () => {
    const blocks = [block('gym', '07:00', '08:00', { areaId: 'gym' }), ...thuBlocks]
    const tasks = [task('laundry', { projectId: 'house', due: THU, estimate: 45 })]
    expect(placed(input({ tasks, blocks }))).toEqual([['laundry', 'gym', 'Due Thu']])
  })

  it('counts what is already scheduled on the date, and never places into protected blocks', () => {
    const blocks = [block('am', '08:00', '09:00'), block('fam', '09:00', '12:00', { protected: true })]
    const tasks = [
      task('mine', { status: 'scheduled', date: THU, blockId: 'am', estimate: 45, reason: 'Added by you' }),
      task('next', { estimate: 30 }),
      task('fits', { estimate: 15 }),
    ]
    const brief = buildBrief(input({ tasks, blocks }))
    expect(brief.placements.map((p) => p.task.id)).toEqual(['fits'])
    expect(brief.used).toBe(60)
  })

  it('may leave the day over capacity when manual adds already exceed it, and adds nothing more', () => {
    const blocks = [block('am', '08:00', '09:00'), block('new', '09:00', '11:00')]
    const tasks = [
      task('mine', { status: 'scheduled', date: THU, blockId: 'new', estimate: 120, reason: 'Added by you' }),
      task('more', { estimate: 15 }),
    ]
    const low = { ...settings, capacity: { ...settings.capacity, 4: 90 } }
    const brief = buildBrief(input({ settings: low, tasks, blocks }))
    expect(brief.placements).toEqual([])
    expect(brief.used - brief.cap).toBe(30)
  })

  it('skips tasks removed at review', () => {
    const tasks = [task('gone', { due: THU }), task('kept')]
    expect(placed(input({ tasks, removed: ['gone'] }))).toEqual([['kept', 'am', 'Waiting since 1 Oct']])
  })
})
