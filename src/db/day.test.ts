import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { goalNumber } from '../lib/progress'
import { tickBlock, untickBlock } from './day'
import { updateDetails } from './goals'
import { completeTask, tickGoal, uncompleteTask } from './tasks'
import { BriefDB } from './db'
import { seed } from './seed'

const now = new Date(2026, 9, 13, 18) // Tue 13 Oct 2026, in the Gym block
let db: BriefDB

beforeEach(async () => {
  db = new BriefDB(`test-${crypto.randomUUID()}`)
  await db.open()
  await seed(db, now)
  await db.blocks.bulkAdd([
    { id: 'gym', areaId: 'area-gym', date: '2026-10-13', start: '17:30', end: '19:00', protected: false },
    { id: 'focus', areaId: 'area-focus', date: '2026-10-13', start: '08:00', end: '12:00', protected: false },
  ])
})

const lifting = async () => goalNumber((await db.goals.get('goal-lifting'))!, [], await db.logEntries.toArray(), now)

describe('block goal ticks', () => {
  it('ticking a Gym block logs one entry against Lifting; ticking again does nothing', async () => {
    expect(await lifting()).toBe('0 of 5 this week')
    await tickBlock('gym', { now, db })
    await tickBlock('gym', { now, db })
    expect(await db.logEntries.toArray()).toMatchObject([{ goalId: 'goal-lifting', blockId: 'gym' }])
    expect((await db.logEntries.toArray())[0].taskId).toBeUndefined()
    expect(await lifting()).toBe('1 of 5 this week')
  })

  it('untick removes the entry', async () => {
    await tickBlock('gym', { now, db })
    await untickBlock('gym', db)
    expect(await db.logEntries.count()).toBe(0)
    expect(await lifting()).toBe('0 of 5 this week')
  })

  it('a block no goal is served by logs nothing', async () => {
    await tickBlock('focus', { now, db })
    await tickBlock('missing', { now, db })
    expect(await db.logEntries.count()).toBe(0)
  })
})

describe('detail fields on tick', () => {
  const task = (id: string, extra: object) =>
    db.tasks.add({ id, title: id, estimate: 30, areaId: 'area-focus', goalId: 'g-none', status: 'backlog', rollovers: 0, delegable: false, createdAt: now.toISOString(), ...extra })

  it('a block tick stores its details; Skip (none) still logs; untick takes them away', async () => {
    await tickBlock('gym', { details: { lift: 'Snatch', weight: '80kg' }, now, db })
    expect((await db.logEntries.toArray())[0].details).toEqual({ lift: 'Snatch', weight: '80kg' })
    await untickBlock('gym', db)
    await tickBlock('gym', { now, db })
    const [entry] = await db.logEntries.toArray()
    expect(entry.goalId).toBe('goal-lifting')
    expect(entry.details).toBeUndefined()
  })

  it('tickGoal names the goal that will be logged, so the form only asks when it counts', async () => {
    await task('apply', { goalId: 'goal-job' })
    await task('in-gym', { goalId: 'goal-lifting', status: 'scheduled', date: '2026-10-13', blockId: 'gym' })
    await task('loose', {})
    expect((await tickGoal('apply', db))?.detailFields).toEqual(['role', 'company'])
    expect(await tickGoal('in-gym', db)).toBeUndefined() // the Gym block tick covers it
    expect(await tickGoal('loose', db)).toBeUndefined()
  })

  it('Did it logs as of the block end; undo removes the entry with its details', async () => {
    await task('apply', { goalId: 'goal-job', status: 'scheduled', date: '2026-10-13', blockId: 'focus' })
    const end = new Date(2026, 9, 13, 12)
    await completeTask('apply', { details: { role: 'Analyst' }, now: end, db })
    const [entry] = await db.logEntries.toArray()
    expect(entry).toMatchObject({ completedAt: end.toISOString(), details: { role: 'Analyst' } })
    expect((await db.tasks.get('apply'))!.rollovers).toBe(0)
    await uncompleteTask('apply', db)
    expect(await db.logEntries.count()).toBe(0)
    expect((await db.tasks.get('apply'))!.status).toBe('scheduled')
  })

  it('details can be filled in later; when and what never change', async () => {
    await tickBlock('gym', { now, db })
    const [before] = await db.logEntries.toArray()
    await updateDetails(before.id, { lift: 'Clean & jerk', weight: '100kg' }, db)
    expect(await db.logEntries.get(before.id)).toEqual({ ...before, details: { lift: 'Clean & jerk', weight: '100kg' } })
    await updateDetails(before.id, undefined, db)
    expect(await db.logEntries.get(before.id)).toEqual(before)
  })
})
