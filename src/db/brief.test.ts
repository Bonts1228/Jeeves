import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { addToBrief, briefState, confirmBrief, fillBrief, readBrief, removeFromBrief } from './brief'
import { ensureBlocks } from './blocks'
import { BriefDB } from './db'
import { seed } from './seed'

// The seed week, briefing Thu 15 Oct 2026 on Wed 14 Oct at 21:00.
// Thu has three Focus blocks (08–12, 13:30–16:30, 20–22) and capacity 9h.
const THU = '2026-10-15'
const wed = new Date(2026, 9, 14, 21)

describe('fillBrief', () => {
  let db: BriefDB
  beforeEach(async () => {
    db = new BriefDB(`test-${crypto.randomUUID()}`)
    await db.open()
    await seed(db, wed)
  })

  const scheduled = async () =>
    (await db.tasks.where('date').equals(THU).toArray())
      .filter((t) => t.status === 'scheduled')
      .map((t) => [t.title, t.blockId!.split('@')[0], t.reason])

  it("fills the seed's Thursday by rank, block by block, with a reason on each", async () => {
    const brief = await fillBrief(THU, { now: wed, db })
    expect(brief.placements.map((p) => [p.task.title, p.blockId.split('@')[0], p.reason])).toEqual([
      ['Do laundry', 'tpl-4-1', 'Due Thu · every 8 days'],
      ['M2 Backlog + capture (1/2)', 'tpl-4-1', 'Launch Jeeves: next step'],
      ['Update CV', 'tpl-4-2', 'Job search setup: next step'],
      ['Scope Trellis MVP', 'tpl-4-3', 'Launch Trellis: next step'],
      ['Application #1', 'tpl-4-2', expect.stringMatching(/^Waiting since /)],
    ])
    expect([brief.used, brief.cap]).toEqual([505, 540])
    expect(await scheduled()).toHaveLength(5)
  })

  it("leaves today's tasks in a block still running alone, and carries ones from ended blocks", async () => {
    const WED = '2026-10-14'
    await ensureBlocks(WED, db)
    const base = (await db.tasks.toArray()).find((t) => t.title === 'Update CV')!
    const left = { ...base, title: 'Left', status: 'scheduled' as const, date: WED, order: undefined, projectId: undefined }
    await db.tasks.bulkAdd([
      { ...left, id: 'ended', blockId: `tpl-3-1@${WED}` },
      { ...left, id: 'running', blockId: `tpl-3-4@${WED}` }, // 20:00–22:00, brief at 21:00
    ])
    await fillBrief(THU, { now: wed, db })
    expect(await db.tasks.get('ended')).toMatchObject({ date: THU, reason: 'Carried from today', rollovers: 1 })
    expect(await db.tasks.get('running')).toMatchObject({ date: WED, blockId: `tpl-3-4@${WED}` })
  })

  it('only adds on a second run', async () => {
    await fillBrief(THU, { now: wed, db })
    const before = await scheduled()
    const again = await fillBrief(THU, { now: wed, db })
    expect(again.placements).toEqual([])
    expect(await scheduled()).toEqual(before)
  })

  it('keeps a removed task out of refills, back in the Backlog', async () => {
    const { placements } = await fillBrief(THU, { now: wed, db })
    const cv = placements.find((p) => p.task.title === 'Update CV')!.task.id
    await removeFromBrief(THU, cv, db)
    const back = await db.tasks.get(cv)
    expect([back?.status, back?.date, back?.reason]).toEqual(['backlog', undefined, undefined])
    const refill = await fillBrief(THU, { now: wed, db })
    expect(refill.placements.map((p) => p.task.id)).not.toContain(cv)
    expect((await briefState(THU, db))?.removed).toEqual([cv])
  })

  it('moves overdue tasks onto the date and counts a rollover', async () => {
    await db.tasks.update('task-11', { status: 'scheduled', date: '2026-10-13', blockId: 'x', reason: 'Added by you' })
    const brief = await fillBrief(THU, { now: wed, db })
    expect(brief.placements[0]).toMatchObject({ reason: 'Overdue from Tue', tier: 1 })
    expect(await db.tasks.get('task-11')).toMatchObject({ date: THU, rollovers: 1, reason: 'Overdue from Tue' })
  })

  it('adds a task yourself, any area for manual-only, and takes it off the removed list', async () => {
    const { placements } = await fillBrief(THU, { now: wed, db })
    const laundry = placements[0].task.id
    await removeFromBrief(THU, laundry, db)
    expect(await addToBrief(THU, laundry, { blockId: `tpl-4-1@${THU}` }, { now: wed, db })).toBe(true)
    expect(await db.tasks.get(laundry)).toMatchObject({ status: 'scheduled', date: THU, reason: 'Added by you' })
    expect((await briefState(THU, db))?.removed).toEqual([])
    // A block without room: nothing written
    expect(await addToBrief(THU, 'task-34', { blockId: `tpl-4-3@${THU}` }, { now: wed, db })).toBe(false)
    expect((await db.tasks.get('task-34'))?.status).toBe('backlog')
    // New one-off block
    expect(await addToBrief(THU, 'task-34', { newBlock: { start: '17:00', end: '19:00', areaId: 'area-focus' } }, { now: wed, db })).toBe(true)
  })

  it('reads without writing, and records confirmation', async () => {
    await fillBrief(THU, { now: wed, db })
    const { placements, notPlaced } = await readBrief(THU, { now: wed, db })
    expect([placements, notPlaced]).toEqual([[], []])
    await confirmBrief(THU, { now: wed, db })
    expect(await briefState(THU, db)).toMatchObject({ confirmedAt: wed.toISOString() })
  })
})
