import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { HOUSEKEEPING_ID, type Task } from '../types'
import { ensureBlocks, scheduleNewTask } from './blocks'
import { BriefDB } from './db'
import { addTask, updateTask } from './tasks'

// Fri 16 Oct 2026; "now" is Thu 15 Oct.
const FRI = '2026-10-16'
const AM = 'fri-am@2026-10-16' // 08:00–12:00, 240m
const GYM = 'fri-gym@2026-10-16' // 17:30–19:00, 90m
const now = new Date(2026, 9, 15, 12)

const task = (extra: Partial<Task>): Task => ({
  id: 't',
  goalId: 'g-none', // no such goal row: not Housekeeping, so not manual-only
  title: 'Task',
  estimate: 30,
  areaId: 'area-focus',
  status: 'backlog',
  rollovers: 0,
  delegable: false,
  createdAt: now.toISOString(),
  ...extra,
})
const scheduled = (id: string, blockId: string, estimate: number) =>
  task({ id, estimate, status: 'scheduled', date: FRI, blockId, reason: 'Added by you' })

let db: BriefDB
beforeEach(async () => {
  db = new BriefDB(`test-${crypto.randomUUID()}`)
  await db.open()
  await db.blockTemplates.bulkAdd([
    { id: 'fri-am', weekday: 5, areaId: 'area-focus', start: '08:00', end: '12:00', protected: false },
    { id: 'fri-gym', weekday: 5, areaId: 'area-gym', start: '17:30', end: '19:00', protected: false },
  ])
  await ensureBlocks(FRI, db)
})

describe('editing a scheduled task re-runs the room check', () => {
  beforeEach(async () => {
    await db.tasks.bulkAdd([scheduled('cv', AM, 180), scheduled('stamps', AM, 30)]) // 30m free in AM
  })

  it('a bigger estimate that still fits is saved', async () => {
    expect(await updateTask('stamps', { estimate: 60 }, undefined, { now, db })).toBe('ok')
    expect((await db.tasks.get('stamps'))?.estimate).toBe(60)
  })

  it("a bigger estimate that doesn't fit is refused and nothing changes", async () => {
    const before = await db.tasks.toArray()
    expect(await updateTask('stamps', { estimate: 90, title: 'Renamed' }, undefined, { now, db })).toBe('no-room')
    expect(await db.tasks.toArray()).toEqual(before)
  })

  it('a smaller estimate needs no room', async () => {
    await db.tasks.update('cv', { estimate: 400 }) // overfilled by hand: shrinking must still be allowed
    expect(await updateTask('stamps', { estimate: 15 }, undefined, { now, db })).toBe('ok')
  })

  it('moving to a full block is refused; to a block with room is saved', async () => {
    await db.tasks.add(scheduled('lift', GYM, 90))
    expect(await updateTask('stamps', {}, { date: FRI, placement: { blockId: GYM } }, { now, db })).toBe('no-room')
    expect((await db.tasks.get('stamps'))?.blockId).toBe(AM)
    await db.tasks.delete('lift')
    expect(await updateTask('stamps', {}, { date: FRI, placement: { blockId: GYM } }, { now, db })).toBe('ok')
    expect((await db.tasks.get('stamps'))?.blockId).toBe(GYM)
  })

  it("re-picking its own block counts the task's own minutes as free", async () => {
    expect(await updateTask('stamps', { estimate: 60 }, { date: FRI, placement: { blockId: AM } }, { now, db })).toBe('ok')
  })

  it('moving to a new one-off block, or back to the Backlog', async () => {
    const newBlock = { start: '13:00', end: '14:00', areaId: 'area-focus' }
    expect(await updateTask('stamps', {}, { date: FRI, placement: { newBlock } }, { now, db })).toBe('ok')
    const moved = await db.tasks.get('stamps')
    expect(await db.blocks.get(moved!.blockId!)).toMatchObject({ start: '13:00', end: '14:00', date: FRI })

    expect(await updateTask('stamps', {}, null, { now, db })).toBe('ok')
    const back = await db.tasks.get('stamps')
    expect(back).toMatchObject({ status: 'backlog' })
    expect([back?.date, back?.blockId, back?.reason]).toEqual([undefined, undefined, undefined])
  })
})

describe('editing a repeat rule', () => {
  it('applies to this occurrence and later open ones, never done ones', async () => {
    const every8 = { kind: 'every', days: 8 } as const
    await db.tasks.bulkAdd([
      task({ id: 'p', status: 'done', due: '2026-10-01', repeat: every8 }), // earlier, done
      task({ id: 'a', prevId: 'p', due: '2026-10-09', repeat: every8 }), // this one (reopened by Undo)
      task({ id: 'b', prevId: 'a', status: 'done', due: '2026-10-17', repeat: every8 }), // later, done
      task({ id: 'c', prevId: 'b', due: '2026-10-25', repeat: every8 }), // later, open
    ])
    const sundays = { kind: 'weekly', weekday: 0 } as const
    expect(await updateTask('a', { repeat: sundays }, undefined, { now, db })).toBe('ok')
    const rules = Object.fromEntries((await db.tasks.toArray()).map((t) => [t.id, t.repeat]))
    expect(rules).toEqual({ p: every8, a: sundays, b: every8, c: sundays })

    await updateTask('a', { repeat: undefined }, undefined, { now, db }) // stop repeating
    expect((await db.tasks.get('c'))?.repeat).toBeUndefined()
    expect((await db.tasks.get('b'))?.repeat).toEqual(every8)
  })

  it('done tasks are never edited', async () => {
    await db.tasks.add(task({ id: 'd', status: 'done' }))
    expect(await updateTask('d', { title: 'X' }, undefined, { now, db })).toBe('closed')
    expect((await db.tasks.get('d'))?.title).toBe('Task')
  })
})

describe('every task has a home (M7)', () => {
  beforeEach(async () => {
    await db.projects.add({ id: 'p', title: 'Job search setup', goalId: 'job' })
  })

  it('a project task takes its project’s goal; with neither it goes to Housekeeping', async () => {
    await addTask(task({ id: 'cv', projectId: 'p', goalId: 'other' }), { db })
    expect((await db.tasks.get('cv'))?.goalId).toBe('job')
    await addTask(task({ id: 'bank', goalId: '' }), { db })
    expect((await db.tasks.get('bank'))?.goalId).toBe(HOUSEKEEPING_ID)
    expect(await scheduleNewTask(task({ id: 'post', projectId: 'p' }), FRI, { blockId: AM }, { now, db })).toBe(true)
    expect((await db.tasks.get('post'))?.goalId).toBe('job')
  })

  it('moving a task into or out of a project moves its goal', async () => {
    await addTask(task({ id: 'x', goalId: 'course' }), { db })
    await updateTask('x', { projectId: 'p' }, undefined, { now, db })
    expect(await db.tasks.get('x')).toMatchObject({ goalId: 'job', projectId: 'p' })
    await updateTask('x', { projectId: undefined, goalId: undefined }, undefined, { now, db })
    const x = (await db.tasks.get('x'))!
    expect(x.goalId).toBe(HOUSEKEEPING_ID)
    expect(x.projectId).toBeUndefined()
  })

  it('a schedule that no longer fits writes nothing', async () => {
    await db.tasks.add(scheduled('cv', AM, 240))
    expect(await scheduleNewTask(task({ id: 'post' }), FRI, { blockId: AM }, { now, db })).toBe(false)
    expect(await db.tasks.get('post')).toBeUndefined()
  })
})
