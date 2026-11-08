import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { unfinishedTasks } from '../lib/unfinished'
import type { Task } from '../types'
import { blockEditProblem, ensureBlocks } from './blocks'
import { readBrief } from './brief'
import { addBlock, deleteBlock, updateBlockTimes } from './day-blocks'
import { BriefDB, SETTINGS_KEY } from './db'

// Thu 15 Oct 2026 at 09:00 (today) and Fri 16 Oct (tomorrow).
const THU = '2026-10-15'
const FRI = '2026-10-16'
const now = new Date(2026, 9, 15, 9)

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  goalId: 'g-none', // no such goal row: not Housekeeping, so not manual-only
  title: id,
  estimate: 30,
  areaId: 'area-focus',
  status: 'scheduled',
  date: THU,
  blockId: `thu-am@${THU}`,
  reason: 'Waiting since 2 Oct',
  rollovers: 0,
  delegable: false,
  createdAt: new Date(2026, 9, 1).toISOString(),
  ...extra,
})

describe('per-day block editor', () => {
  let db: BriefDB
  beforeEach(async () => {
    db = new BriefDB(`test-${crypto.randomUUID()}`)
    await db.open()
    await db.settings.put({ briefTime: '21:00', capacity: { 0: 180, 1: 540, 2: 540, 3: 540, 4: 540, 5: 420, 6: 180 } }, SETTINGS_KEY)
    await db.areas.bulkAdd([
      { id: 'area-focus', name: 'Focus' },
      { id: 'area-gym', name: 'Gym' },
    ])
    await db.blockTemplates.bulkAdd([
      { id: 'thu-am', weekday: 4, areaId: 'area-focus', start: '08:00', end: '12:00', protected: false },
      { id: 'thu-pm', weekday: 4, areaId: 'area-focus', start: '14:00', end: '16:00', protected: false },
      { id: 'fri-am', weekday: 5, areaId: 'area-focus', start: '08:00', end: '12:00', protected: false },
      { id: 'fri-gym', weekday: 5, areaId: 'area-gym', start: '17:00', end: '18:00', protected: false },
    ])
    await ensureBlocks(THU, db)
    await ensureBlocks(FRI, db)
  })

  it("edits one day's block times, never the template", async () => {
    expect(await updateBlockTimes(`thu-pm@${THU}`, { start: '13:00', end: '15:00' }, { now, db })).toBeNull()
    expect(await db.blocks.get(`thu-pm@${THU}`)).toMatchObject({ start: '13:00', end: '15:00', templateId: 'thu-pm' })
    expect(await db.blockTemplates.get('thu-pm')).toMatchObject({ start: '14:00', end: '16:00' })
    expect(await updateBlockTimes(`thu-pm@${THU}`, { start: '11:00', end: '15:00' }, { now, db })).toBe('Overlaps 08:00–12:00.')
    expect(await db.blocks.get(`thu-pm@${THU}`)).toMatchObject({ start: '13:00' })
  })

  it('adds an empty one-off block; today it must end after now, tomorrow any time', async () => {
    expect(await addBlock(THU, { areaId: 'area-gym', start: '06:00', end: '07:00' }, { now, db })).toBe('Must end after now.')
    expect(await addBlock(FRI, { areaId: 'area-gym', start: '06:00', end: '07:00' }, { now, db })).toBeNull()
    const made = (await db.blocks.where('date').equals(FRI).toArray()).find((b) => b.start === '06:00')
    expect(made).toMatchObject({ areaId: 'area-gym', end: '07:00', protected: false })
    expect(made?.templateId).toBeUndefined()
  })

  it("deleting today's block sends its open tasks to Unfinished, untouched", async () => {
    await db.tasks.bulkAdd([task('a'), task('done', { status: 'done' })])
    await deleteBlock(`thu-am@${THU}`, { now, db })
    expect(await db.blocks.get(`thu-am@${THU}`)).toBeUndefined()
    expect(await db.tasks.get('a')).toMatchObject({ status: 'scheduled', date: THU, blockId: `thu-am@${THU}`, rollovers: 0 })
    const blocks = await db.blocks.where('date').equals(THU).toArray()
    expect(unfinishedTasks(THU, await db.tasks.toArray(), blocks, now).map((t) => t.id)).toEqual(['a'])
    // The day isn't made again from its templates
    expect((await ensureBlocks(THU, db)).map((b) => b.id)).toEqual([`thu-pm@${THU}`])
  })

  it("deleting tomorrow's block sends its tasks back to the brief: Backlog, no rollover, Not placed if still ranked", async () => {
    const gym = `fri-gym@${FRI}`
    await db.tasks.bulkAdd([
      task('deadlift', { areaId: 'area-gym', date: FRI, blockId: gym, due: FRI, reason: 'Due Fri', rollovers: 2 }),
      task('done', { areaId: 'area-gym', date: FRI, blockId: gym, status: 'done' }),
    ])
    await deleteBlock(gym, { now, db })
    const back = await db.tasks.get('deadlift')
    expect(back).toMatchObject({ status: 'backlog', rollovers: 2 })
    expect([back!.date, back!.blockId, back!.reason]).toEqual([undefined, undefined, undefined])
    expect(await db.tasks.get('done')).toMatchObject({ status: 'done', blockId: gym })
    const brief = await readBrief(FRI, { now, db })
    expect(brief.notPlaced.map((n) => [n.task.id, n.reason, n.why])).toEqual([['deadlift', 'Due Fri', 'No Gym block Fri']])
  })

  it('blockEditProblem checks times and overlaps, ignoring the block being edited', async () => {
    const day = await db.blocks.where('date').equals(THU).toArray()
    expect(blockEditProblem({ start: '', end: '10:00' }, day, FRI, now)).toBe('Pick a start and end.')
    expect(blockEditProblem({ start: '10:00', end: '10:00' }, day, FRI, now)).toBe('End must be after start.')
    expect(blockEditProblem({ start: '11:00', end: '15:00' }, day, THU, now)).toBe('Overlaps 08:00–12:00.')
    expect(blockEditProblem({ start: '08:30', end: '12:00' }, day, THU, now, `thu-am@${THU}`)).toBeNull()
  })
})
