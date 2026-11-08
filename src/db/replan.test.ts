import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { BriefDB, SETTINGS_KEY } from './db'
import { addUrgent, undoUrgent } from './replan'
import { completeTask } from './tasks'

const now = new Date(2026, 9, 15, 10) // Thu 15 Oct 2026, 10:00
const date = '2026-10-15'
let db: BriefDB

const task = (id: string, estimate: number, extra: Partial<Task> = {}): Task => ({
  id,
  goalId: 'g-none', // no such goal row: not Housekeeping, so not manual-only
  title: id,
  estimate,
  areaId: 'work',
  status: 'scheduled',
  date,
  blockId: 'pm',
  reason: 'Waiting since 1 Oct',
  rollovers: 2,
  delegable: false,
  createdAt: new Date(2026, 9, 1, 0, id.charCodeAt(0)).toISOString(),
  ...extra,
})
const urgent = task('urgent', 60, { status: 'backlog', date: undefined, blockId: undefined, reason: undefined, rollovers: 0, due: date })

beforeEach(async () => {
  db = new BriefDB(`test-${crypto.randomUUID()}`)
  await db.open()
  await db.settings.put({ briefTime: '20:00', capacity: { 0: 480, 1: 480, 2: 480, 3: 480, 4: 480, 5: 480, 6: 480 } }, SETTINGS_KEY)
  await db.meta.put('1', `blocks:${date}`) // the day is made: no templates
  await db.blocks.bulkAdd([
    { id: 'pm', areaId: 'work', date, start: '14:00', end: '15:00', protected: false },
    { id: 'eve', areaId: 'work', date, start: '17:00', end: '17:30', protected: false },
  ])
  await db.tasks.bulkAdd([task('a', 30), task('b', 30)])
})

describe('urgent capture', () => {
  it('places the task, moves the lowest-ranked out with no rollover, and Undo restores everything exactly', async () => {
    const before = await db.tasks.toArray()
    const result = await addUrgent(urgent, { now, db })
    expect(result).toMatchObject({ placed: true, blockId: 'pm', moves: [{ task: { id: 'a' }, to: 'eve' }, { task: { id: 'b' }, to: null }] })
    expect(await db.tasks.get('urgent')).toMatchObject({ status: 'scheduled', date, blockId: 'pm', reason: 'Due today' })
    expect(await db.tasks.get('a')).toMatchObject({ status: 'scheduled', blockId: 'eve', reason: 'Waiting since 1 Oct', rollovers: 2 })
    const b = (await db.tasks.get('b'))!
    expect(b).toMatchObject({ status: 'backlog', rollovers: 2 })
    expect(b.date ?? b.blockId ?? b.reason).toBeUndefined()

    if (!result.placed) throw new Error('placed')
    expect(await undoUrgent(result.snapshot, db)).toEqual([])
    expect(await db.tasks.toArray()).toEqual(before)
  })

  it('Undo leaves alone a moved task that changed since, and names it', async () => {
    const result = await addUrgent(urgent, { now, db })
    if (!result.placed) throw new Error('placed')
    await completeTask('a', { now, db })
    expect(await undoUrgent(result.snapshot, db)).toEqual(['a'])
    expect((await db.tasks.get('a'))!.status).toBe('done')
    expect(await db.tasks.get('urgent')).toBeUndefined()
    expect(await db.tasks.get('b')).toMatchObject({ status: 'scheduled', blockId: 'pm' })
  })

  it('fits nowhere: saved to the Backlog due today, nothing moved', async () => {
    const big = { ...urgent, estimate: 120 }
    expect(await addUrgent(big, { now, db })).toEqual({ placed: false, why: 'no-room' })
    expect(await db.tasks.get('urgent')).toMatchObject({ status: 'backlog', due: date })
    expect(await db.tasks.get('a')).toMatchObject({ status: 'scheduled', blockId: 'pm' })
  })
})
