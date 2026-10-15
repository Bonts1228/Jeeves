import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { ensureBlocks } from './blocks'
import { BriefDB } from './db'
import { blockEndAt, unfinishedGroups } from '../lib/unfinished'
import { tickBlock } from './day'
import { addBlock } from './day-blocks'
import { dismissedUnfinished, dismissUnfinished, moveSession, readNextBlocks, readNextSessions, rollOver, skipBlockGoal } from './unfinished'

// Thu 15 Oct 2026 at 12:30: the morning Focus block has ended with two tasks open.
const THU = '2026-10-15'
const FRI = '2026-10-16'
const now = new Date(2026, 9, 15, 12, 30)

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  estimate: 30,
  areaId: 'area-focus',
  status: 'scheduled',
  date: THU,
  blockId: `thu-am@${THU}`,
  reason: 'Waiting since 2 Oct',
  rollovers: 1,
  delegable: false,
  createdAt: new Date(2026, 9, 1).toISOString(),
  ...extra,
})

describe('unfinished', () => {
  let db: BriefDB
  beforeEach(async () => {
    db = new BriefDB(`test-${crypto.randomUUID()}`)
    await db.open()
    await db.blockTemplates.bulkAdd([
      { id: 'thu-am', weekday: 4, areaId: 'area-focus', start: '08:00', end: '12:00', protected: false },
      { id: 'thu-pm', weekday: 4, areaId: 'area-focus', start: '14:00', end: '15:00', protected: false },
      { id: 'fri-am', weekday: 5, areaId: 'area-focus', start: '08:00', end: '12:00', protected: false },
    ])
    await ensureBlocks(THU, db)
    await db.tasks.bulkAdd([task('a'), task('b', { estimate: 45 })])
  })

  it('Next block moves the task into the block with room and counts a rollover; the reason stays', async () => {
    expect(await rollOver('a', { date: THU, placement: { blockId: `thu-pm@${THU}` } }, { now, db })).toBe(true)
    expect(await db.tasks.get('a')).toMatchObject({ status: 'scheduled', date: THU, blockId: `thu-pm@${THU}`, rollovers: 2, reason: 'Waiting since 2 Oct' })
  })

  it("a block without room writes nothing, not even the rollover", async () => {
    await rollOver('a', { date: THU, placement: { blockId: `thu-pm@${THU}` } }, { now, db })
    expect(await rollOver('b', { date: THU, placement: { blockId: `thu-pm@${THU}` } }, { now, db })).toBe(false)
    expect(await db.tasks.get('b')).toMatchObject({ blockId: `thu-am@${THU}`, rollovers: 1 })
  })

  it('Pick a block can make a new one-off block, tomorrow too', async () => {
    const placement = { newBlock: { start: '13:00', end: '14:00', areaId: 'area-focus' } }
    expect(await rollOver('b', { date: FRI, placement }, { now, db })).toBe(true)
    const b = await db.tasks.get('b')
    expect(b).toMatchObject({ date: FRI, rollovers: 2 })
    expect(await db.blocks.get(b!.blockId!)).toMatchObject({ date: FRI, start: '13:00', protected: false })
  })

  it('Back to Backlog clears date, blockId and reason and counts a rollover', async () => {
    expect(await rollOver('a', null, { now, db })).toBe(true)
    const a = await db.tasks.get('a')
    expect(a).toMatchObject({ status: 'backlog', rollovers: 2 })
    expect([a!.date, a!.blockId, a!.reason]).toEqual([undefined, undefined, undefined])
    // Already moved on: a second tap does nothing
    expect(await rollOver('a', null, { now, db })).toBe(false)
    expect((await db.tasks.get('a'))!.rollovers).toBe(2)
  })

  it("Next block: today's later block with room, else tomorrow's, else none", async () => {
    await ensureBlocks(FRI, db)
    const tasks = await db.tasks.toArray()
    let next = await readNextBlocks(tasks, { now, db })
    expect([next.get('a')?.id, next.get('b')?.id]).toEqual([`thu-pm@${THU}`, `thu-pm@${THU}`])
    await rollOver('a', { date: THU, placement: { blockId: `thu-pm@${THU}` } }, { now, db })
    next = await readNextBlocks(await db.tasks.toArray(), { now, db })
    expect(next.get('b')?.id).toBe(`fri-am@${FRI}`)
    await db.tasks.add(task('huge', { estimate: 300 }))
    expect((await readNextBlocks([(await db.tasks.get('huge'))!], { now, db })).get('huge')).toBeNull()
  })

  it('remembers dismissed tasks per date', async () => {
    expect(await dismissedUnfinished(THU, db)).toEqual([])
    await dismissUnfinished(THU, ['a'], db)
    await dismissUnfinished(THU, ['a', 'b'], db)
    expect(await dismissedUnfinished(THU, db)).toEqual(['a', 'b'])
    expect(await dismissedUnfinished(FRI, db)).toEqual([])
  })

  describe('block goal at block end', () => {
    const gymId = `thu-gym@${THU}`
    const ask = async () =>
      unfinishedGroups(THU, [], await db.blocks.where('date').equals(THU).toArray(), now, {
        goals: await db.goals.toArray(),
        logs: await db.logEntries.toArray(),
        dismissed: await dismissedUnfinished(THU, db),
      }).filter((g) => g.goal)
    beforeEach(async () => {
      await db.goals.add({ id: 'lift', title: 'Lifting', type: 'recurring', areaId: 'area-gym', target: 4, period: 'week', servedByBlocks: true })
      await db.blocks.add({ id: gymId, date: THU, areaId: 'area-gym', start: '11:00', end: '12:00', protected: false })
    })

    it('Done ticks the block as of its end', async () => {
      expect((await ask()).map((g) => g.block?.id)).toEqual([gymId])
      const block = (await db.blocks.get(gymId))!
      await tickBlock(gymId, { now: blockEndAt(block), db })
      expect(await db.logEntries.toArray()).toMatchObject([
        { goalId: 'lift', blockId: gymId, completedAt: new Date(2026, 9, 15, 12).toISOString() },
      ])
      expect(await ask()).toEqual([])
    })

    it('Move session: offers the next Gym block, logs nothing, and the moved-to block asks if it ends unticked', async () => {
      const gym = (await db.blocks.get(gymId))!
      // No later Gym block today or tomorrow yet
      await ensureBlocks(FRI, db)
      expect((await readNextSessions([gym], { now, db })).get(gymId)).toBeNull()
      // New block: a one-off Gym block later today
      expect(await addBlock(THU, { areaId: 'area-gym', start: '18:00', end: '19:00' }, { now, db })).toBeNull()
      const later = (await db.blocks.where('date').equals(THU).toArray()).find((b) => b.start === '18:00')!
      expect((await readNextSessions([gym], { now, db })).get(gymId)?.id).toBe(later.id)

      await moveSession(THU, gymId, db)
      expect(await db.logEntries.count()).toBe(0)
      expect(await ask()).toEqual([])
      // 19:30: the moved-to block ended unticked, so it asks in turn
      const evening = new Date(2026, 9, 15, 19, 30)
      const askAt = async (at: Date) =>
        unfinishedGroups(THU, [], await db.blocks.where('date').equals(THU).toArray(), at, {
          goals: await db.goals.toArray(),
          logs: await db.logEntries.toArray(),
          dismissed: await dismissedUnfinished(THU, db),
        })
          .filter((g) => g.goal)
          .map((g) => g.block!.id)
      expect(await askAt(evening)).toEqual([later.id])
      // Lifting counts only once a block is ticked
      await tickBlock(later.id, { now: blockEndAt(later), db })
      expect(await db.logEntries.toArray()).toMatchObject([{ goalId: 'lift', blockId: later.id }])
      expect(await askAt(evening)).toEqual([])
    })

    it('Skipped writes no log and stops asking for that block', async () => {
      await skipBlockGoal(THU, gymId, db)
      expect(await db.logEntries.count()).toBe(0)
      expect(await ask()).toEqual([])
    })
  })
})
