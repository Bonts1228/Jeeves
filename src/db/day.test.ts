import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { goalNumber } from '../lib/progress'
import { tickBlock, untickBlock } from './day'
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
