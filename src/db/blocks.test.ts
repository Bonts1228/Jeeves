import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { blocksWithRoom, ensureBlocks, oneOffProblem, scheduleNewTask } from './blocks'
import { BriefDB } from './db'

// Fri 16 Oct 2026 (weekday 5). "Now" is Thu 15 Oct unless a test says otherwise.
const FRI = '2026-10-16'
const thu = new Date(2026, 9, 15, 12)
const fri = (h: number, m = 0) => new Date(2026, 9, 16, h, m)

const task = (extra: Partial<Task> = {}): Task => ({
  id: 'new',
  title: 'Admin/post',
  estimate: 30,
  areaId: 'area-focus',
  projectId: 'proj-housekeeping',
  status: 'backlog',
  rollovers: 0,
  delegable: false,
  createdAt: thu.toISOString(),
  ...extra,
})

describe('blocks', () => {
  let db: BriefDB
  beforeEach(async () => {
    db = new BriefDB(`test-${crypto.randomUUID()}`)
    await db.open()
    await db.blockTemplates.bulkAdd([
      { id: 'fri-am', weekday: 5, areaId: 'area-focus', start: '08:00', end: '12:00', protected: false },
      { id: 'fri-gym', weekday: 5, areaId: 'area-gym', start: '17:30', end: '19:00', protected: false },
      { id: 'fri-social', weekday: 5, areaId: 'area-social', start: '19:00', end: '23:00', protected: true },
      { id: 'mon-am', weekday: 1, areaId: 'area-focus', start: '08:00', end: '12:00', protected: false },
    ])
  })

  it("ensureBlocks makes a date's blocks once, from its weekday's templates", async () => {
    const made = await ensureBlocks(FRI, db)
    expect(made.map((b) => b.id).sort()).toEqual(['fri-am@2026-10-16', 'fri-gym@2026-10-16', 'fri-social@2026-10-16'])
    await db.blocks.delete('fri-gym@2026-10-16') // edited for the day
    await Promise.all([ensureBlocks(FRI, db), ensureBlocks(FRI, db)])
    expect(await db.blocks.count()).toBe(2)
  })

  it('lists non-protected blocks of any area with room, in time order', async () => {
    const list = await blocksWithRoom(FRI, 30, { now: thu, db })
    expect(list.map((b) => [b.block.areaId, b.room])).toEqual([
      ['area-focus', 240],
      ['area-gym', 90],
    ])
  })

  it('room subtracts scheduled tasks and, today, the time already gone', async () => {
    await ensureBlocks(FRI, db)
    await db.tasks.add(task({ id: 'cv', estimate: 200, status: 'scheduled', date: FRI, blockId: 'fri-am@2026-10-16' }))
    expect((await blocksWithRoom(FRI, 30, { now: thu, db })).map((b) => b.room)).toEqual([40, 90])
    expect((await blocksWithRoom(FRI, 45, { now: thu, db })).map((b) => b.room)).toEqual([90])
    // At 18:00 on the day: morning gone, gym has an hour left
    expect((await blocksWithRoom(FRI, 30, { now: fri(18), db })).map((b) => b.room)).toEqual([60])
  })

  it('places into a block with room', async () => {
    expect(await scheduleNewTask(task(), FRI, { blockId: 'fri-gym@2026-10-16' }, { now: thu, db })).toBe(true)
    expect(await db.tasks.get('new')).toMatchObject({
      status: 'scheduled',
      date: FRI,
      blockId: 'fri-gym@2026-10-16',
      reason: 'Added by you',
    })
  })

  it('never displaces: a full block or protected block is refused and nothing moves', async () => {
    await ensureBlocks(FRI, db)
    const cv = task({ id: 'cv', estimate: 220, status: 'scheduled', date: FRI, blockId: 'fri-am@2026-10-16' })
    await db.tasks.add(cv)
    expect(await scheduleNewTask(task(), FRI, { blockId: 'fri-am@2026-10-16' }, { now: thu, db })).toBe(false)
    expect(await scheduleNewTask(task(), FRI, { blockId: 'fri-social@2026-10-16' }, { now: thu, db })).toBe(false)
    expect(await db.tasks.get('new')).toBeUndefined()
    expect(await db.tasks.get('cv')).toEqual(cv)
  })

  it('places into a new one-off block in the task area', async () => {
    const placed = await scheduleNewTask(
      task(),
      FRI,
      { newBlock: { start: '13:00', end: '13:30', areaId: 'area-focus' } },
      { now: thu, db },
    )
    expect(placed).toBe(true)
    const t = await db.tasks.get('new')
    const block = await db.blocks.get(t!.blockId!)
    expect(block).toMatchObject({ date: FRI, start: '13:00', end: '13:30', areaId: 'area-focus', protected: false })
    expect(block?.templateId).toBeUndefined()
  })

  it('refuses one-off blocks that overlap, are too short, or start in the past', async () => {
    const day = await ensureBlocks(FRI, db)
    expect(oneOffProblem({ start: '11:00', end: '13:00' }, 30, day, FRI, thu)).toBe('Overlaps 08:00–12:00.')
    expect(oneOffProblem({ start: '13:00', end: '13:15' }, 30, day, FRI, thu)).toBe('Too short for this task.')
    expect(oneOffProblem({ start: '13:00', end: '12:00' }, 30, day, FRI, thu)).toBe('End must be after start.')
    expect(oneOffProblem({ start: '13:00', end: '14:00' }, 30, day, FRI, fri(13, 30))).toBe('Start must be later than now.')
    expect(oneOffProblem({ start: '13:00', end: '14:00' }, 30, day, FRI, thu)).toBeNull()
    const refused = await scheduleNewTask(
      task(),
      FRI,
      { newBlock: { start: '11:00', end: '13:00', areaId: 'area-focus' } },
      { now: thu, db },
    )
    expect(refused).toBe(false)
    expect(await db.blocks.count()).toBe(3)
  })
})
