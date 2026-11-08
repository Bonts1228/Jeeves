import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { HOUSEKEEPING_ID } from '../types'
import { BriefDB, SEED_KEY, SETTINGS_KEY } from './db'
import { buildSeed } from './seed-data'
import { ensureSeeded, SEED_VERSION, seed } from './seed'

async function counts(db: BriefDB) {
  return Object.fromEntries(await Promise.all(db.tables.map(async (t) => [t.name, await t.count()])))
}

describe('seed', () => {
  let db: BriefDB
  beforeEach(async () => {
    db = new BriefDB(`test-${crypto.randomUUID()}`)
    await db.open()
  })

  it('is re-runnable: same rows after running twice, user edits wiped', async () => {
    await seed(db)
    const first = await counts(db)
    await db.tasks.add({ ...(await db.tasks.toCollection().first())!, id: 'stray' })
    await db.areas.update('area-focus', { name: 'Renamed' })
    await seed(db)
    expect(await counts(db)).toEqual(first)
    expect((await db.areas.get('area-focus'))?.name).toBe('Focus')
  })

  it('meets the CLAUDE.md seed requirements', async () => {
    await seed(db)
    const templates = await db.blockTemplates.toArray()
    const goals = await db.goals.toArray()
    const tasks = await db.tasks.toArray()

    expect(await db.settings.get(SETTINGS_KEY)).toBeDefined()
    expect(new Set(templates.map((t) => t.weekday)).size).toBe(7)
    expect(templates.some((t) => t.protected)).toBe(true)
    // M7: the four core goals plus Housekeeping
    expect(goals.map((g) => g.id).sort()).toEqual(['goal-code', 'goal-course', 'goal-housekeeping', 'goal-job', 'goal-lifting'])
    expect([...new Set(goals.map((g) => g.type))].sort()).toEqual(['open_path', 'recurring'])
    expect(goals.filter((g) => g.isHousekeeping).map((g) => g.id)).toEqual([HOUSEKEEPING_ID])
    expect(goals.find((g) => g.isHousekeeping)?.target).toBeUndefined()
    const lifting = goals.find((g) => g.servedByBlocks)
    expect(lifting?.detailFields?.length).toBeGreaterThan(0)

    // Every task has a home; a project task's goal is its project's
    const projects = await db.projects.toArray()
    const goalIds = new Set(goals.map((g) => g.id))
    expect(projects.every((p) => goalIds.has(p.goalId))).toBe(true)
    for (const t of tasks) {
      expect(goalIds.has(t.goalId)).toBe(true)
      if (t.projectId) expect(t.goalId).toBe(projects.find((p) => p.id === t.projectId)?.goalId)
    }
    const bike = (await db.projects.get('proj-motorbike'))!
    expect(bike.goalId).toBe(HOUSEKEEPING_ID)
    const steps = tasks.filter((t) => t.projectId === bike.id).sort((a, b) => a.order! - b.order!)
    expect(steps.length).toBeGreaterThanOrEqual(4)
    expect(steps.length).toBeLessThanOrEqual(6)
    expect(steps.map((t) => t.order)).toEqual(steps.map((_, i) => i + 1))

    expect(tasks.length).toBeGreaterThanOrEqual(20)
    expect(tasks.length).toBeLessThanOrEqual(30)
    expect(tasks.filter((t) => t.due).length).toBeGreaterThan(0)
    const repeating = tasks.filter((t) => t.repeat)
    expect(new Set(repeating.map((t) => t.repeat!.kind))).toEqual(new Set(['every', 'weekly']))
    expect(repeating.every((t) => t.due)).toBe(true)
    expect(tasks.every((t) => t.status === 'backlog' && t.estimate > 0)).toBe(true)
  })

  it('ensureSeeded only seeds an empty database', async () => {
    await ensureSeeded(db)
    await db.areas.update('area-focus', { name: 'Kept' })
    await ensureSeeded(db)
    expect((await db.areas.get('area-focus'))?.name).toBe('Kept')
  })

  it('ensureSeeded replaces data from an older seed once, then keeps edits', async () => {
    // A pre-M7 device: data, but no seed version
    await db.settings.put({ briefTime: '20:00', capacity: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } }, SETTINGS_KEY)
    await db.tasks.add({ ...buildSeed().tasks[0], id: 'old', title: 'Old task' })
    await db.meta.put('2026-11-01T00:00:00.000Z', 'lastExportAt')
    await ensureSeeded(db)
    expect(await db.tasks.get('old')).toBeUndefined()
    expect(await db.goals.get(HOUSEKEEPING_ID)).toBeDefined()
    expect(await db.meta.get(SEED_KEY)).toBe(SEED_VERSION)
    await db.areas.update('area-focus', { name: 'Kept' })
    await ensureSeeded(db)
    expect((await db.areas.get('area-focus'))?.name).toBe('Kept')
  })
})

describe('db upgrade', () => {
  it('v1 → v2 drops recurringBlockId and keeps the goal', async () => {
    const name = `test-${crypto.randomUUID()}`
    const v1 = new Dexie(name)
    v1.version(1).stores({ goals: 'id, areaId' })
    await v1.table('goals').add({ id: 'g', title: 'Lift', type: 'recurring', areaId: 'a', recurringBlockId: 'b' })
    v1.close()

    const db = new BriefDB(name)
    expect(await db.goals.get('g')).toEqual({ id: 'g', title: 'Lift', type: 'recurring', areaId: 'a' })
  })
})
