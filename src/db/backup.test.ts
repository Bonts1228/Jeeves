import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { DATA_TABLES, exportData, type ExportFile, importData, lastExport, parseImport } from './backup'
import { ensureBlocks, scheduleNewTask } from './blocks'
import { tickBlock } from './day'
import { BriefDB, newId, SETTINGS_KEY } from './db'
import { SCHEMA_VERSION } from './migrations'
import { seed } from './seed'
import { addTask, completeTask } from './tasks'

const now = new Date(2026, 9, 15, 12) // Thu 15 Oct 2026
let db: BriefDB

async function snapshot() {
  const tables = Object.fromEntries(await Promise.all(DATA_TABLES.map(async (t) => [t, await db.table(t).toArray()])))
  return { settings: await db.settings.get(SETTINGS_KEY), tables }
}

// A device with more than the seed: generated and one-off blocks, done tasks, logs (incl. a
// block tick), a repeat chain
async function lived() {
  await seed(db, now)
  await ensureBlocks('2026-10-16', db)
  const tasks = await db.tasks.toArray()
  const { repeat: _r, due: _d, ...oneOff } = tasks.find((t) => t.title === 'Do laundry')!
  const laundry = tasks.find((t) => t.title === 'Do laundry')!
  await completeTask(laundry.id, { now, db })
  await completeTask(tasks.find((t) => t.title === 'Update CV')!.id, { now, db })
  await addTask({ ...oneOff, id: newId(), title: 'Ask Sam for referral', projectId: 'proj-job-setup' }, { db })
  const stamps = { ...oneOff, id: newId(), title: 'Buy stamps' }
  await scheduleNewTask(stamps, '2026-10-16', { newBlock: { start: '12:00', end: '12:30', areaId: 'area-focus' } }, { now, db })
  await tickBlock('tpl-5-3@2026-10-16', { now, db }) // Fri's Gym block: a log entry with blockId, no taskId
}

beforeEach(async () => {
  db = new BriefDB(`test-${crypto.randomUUID()}`)
  await db.open()
})

describe('export / import', () => {
  it('the file schema version is the database version', () => {
    expect(SCHEMA_VERSION).toBe(db.verno)
  })

  it('export → reset → import gives identical data', async () => {
    await lived()
    const before = await snapshot()
    const text = JSON.stringify(await exportData(db, now))

    await seed(db, now) // Reset to seed
    expect(await snapshot()).not.toEqual(before)

    const parsed = parseImport(text)
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.summary).toMatchObject({ fromVersion: SCHEMA_VERSION, goals: 5, projects: 5 })
    await importData(parsed.file, db)
    expect(await snapshot()).toStrictEqual(before)
    expect(await lastExport(db)).toBe(now.toISOString())
  })

  it("import clears the device's made-day flags, so imported days keep or remake their blocks", async () => {
    await seed(db, now)
    await ensureBlocks('2026-10-16', db)
    const text = JSON.stringify(await exportData(db, now))
    await db.blocks.clear() // the file has Fri's blocks; a fresh day (Sat) has none
    await ensureBlocks('2026-10-17', db)
    const parsed = parseImport(text)
    if (!parsed.ok) throw new Error(parsed.reason)
    await importData(parsed.file, db)
    expect(await db.meta.get('blocks:2026-10-17')).toBeUndefined()
    expect((await ensureBlocks('2026-10-17', db)).length).toBeGreaterThan(0)
  })

  it('a v1 file imports and migrates', async () => {
    await seed(db, now)
    const v1 = (await exportData(db, now)) as ExportFile & { schemaVersion: number }
    v1.schemaVersion = 1
    v1.tables.goals[3] = { ...v1.tables.goals[3], recurringBlockId: 'tpl-1-3' }
    const parsed = parseImport(JSON.stringify(v1))
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.summary.fromVersion).toBe(1)
    expect(parsed.file.schemaVersion).toBe(SCHEMA_VERSION)
    await importData(parsed.file, db)
    const lifting = (await db.goals.get('goal-lifting'))!
    expect('recurringBlockId' in lifting).toBe(false)
    expect(lifting.title).toBe('Olympic lifting: C&J 120kg, snatch 100kg')
  })

  it('project hold-back round-trips', async () => {
    await lived()
    await db.projects.add({ id: 'p3', title: 'Portfolio', goalId: 'goal-job', notBefore: '2026-11-02', startsAfterProjectId: 'proj-job-setup' })
    const before = await snapshot()
    const parsed = parseImport(JSON.stringify(await exportData(db, now)))
    if (!parsed.ok) throw new Error(parsed.reason)
    await seed(db, now)
    await importData(parsed.file, db)
    expect(await snapshot()).toStrictEqual(before)
    expect(await db.projects.get('p3')).toMatchObject({ notBefore: '2026-11-02', startsAfterProjectId: 'proj-job-setup' })
  })

  it('a v4 file with set paths, the Housekeeping project and an inbox imports as v5', async () => {
    await seed(db, now)
    const v4 = (await exportData(db, now)) as ExportFile & { tables: Record<string, Record<string, unknown>[]> }
    v4.schemaVersion = 4
    v4.tables.goals = v4.tables.goals.filter((g) => g.id !== 'goal-housekeeping')
    v4.tables.goals.push({ id: 'goal-old', title: 'Launch Jeeves', type: 'set_path', areaId: 'area-focus' })
    v4.tables.projects.push({ id: 'proj-housekeeping', title: 'Housekeeping', areaId: 'area-focus', manualOnly: true })
    for (const t of v4.tables.tasks) if (t.goalId === 'goal-housekeeping' && !t.projectId) t.projectId = 'proj-housekeeping'
    v4.tables.tasks.push({ ...v4.tables.tasks[0], id: 'm1', projectId: undefined, goalId: 'goal-old', order: 1 })
    v4.tables.inbox = [{ id: 'in1', text: 'Call the bank', createdAt: now.toISOString() }]
    const parsed = parseImport(JSON.stringify(v4))
    if (!parsed.ok) throw new Error(parsed.reason)
    await importData(parsed.file, db)
    expect(await db.tasks.get('in1')).toMatchObject({ title: 'Call the bank', goalId: 'goal-housekeeping' })
    expect(await db.tasks.get('m1')).toMatchObject({ goalId: 'goal-old', projectId: 'proj-from-goal-old', order: 1 })
    expect(await db.projects.get('proj-housekeeping')).toBeUndefined()
    const laundry = (await db.tasks.toArray()).find((t) => t.title === 'Do laundry')!
    expect(laundry).toMatchObject({ goalId: 'goal-housekeeping' }) // back straight under Housekeeping
    expect(laundry.projectId).toBeUndefined()
  })

  it('a v3 file imports unchanged', async () => {
    await lived()
    const before = await snapshot()
    const v3 = await exportData(db, now)
    v3.schemaVersion = 3
    const parsed = parseImport(JSON.stringify(v3))
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.summary.fromVersion).toBe(3)
    await seed(db, now)
    await importData(parsed.file, db)
    expect(await snapshot()).toStrictEqual(before)
  })

  describe('a bad file changes nothing and says why', () => {
    let good: ExportFile
    let before: Awaited<ReturnType<typeof snapshot>>
    beforeEach(async () => {
      await lived()
      good = await exportData(db, now)
      before = await snapshot()
    })
    const variant = (change: (f: Record<string, any>) => void) => {
      const f = structuredClone(good) as Record<string, any>
      change(f)
      return JSON.stringify(f)
    }
    const project = (f: Record<string, any>, id: string) => f.tables.projects.find((p: { id: string }) => p.id === id)

    it.each([
      ['not JSON', () => '{"app": "daily-brief", "tables": [', "This isn't a valid JSON file."],
      ['another app', () => variant((f) => (f.app = 'todoist')), "This isn't a Daily Brief export."],
      ['newer version', () => variant((f) => (f.schemaVersion = 99)), /newer version of the app \(schema 99/],
      ['missing table', () => variant((f) => delete f.tables.tasks), 'The tasks table is missing.'],
      ['bad row', () => variant((f) => delete f.tables.tasks[11].title), 'Task 12 has a missing or invalid title.'],
      ['bad status', () => variant((f) => (f.tables.tasks[0].status = 'later')), /^Task 1 \(“.+”\) has a missing or invalid status\.$/],
      ['duplicate ids', () => variant((f) => f.tables.goals.push(f.tables.goals[0])), 'Two goal rows share the id goal-code.'],
      [
        'a task with no goal',
        () => variant((f) => (f.tables.tasks[0].goalId = 'gone')),
        /^Task “.+” belongs to a goal or project that isn't in the file\.$/,
      ],
      ['no Housekeeping', () => variant((f) => (f.tables.goals = f.tables.goals.filter((g: { id: string }) => g.id !== 'goal-housekeeping'))), /Housekeeping goal/],
      ['bad settings', () => variant((f) => delete f.settings.capacity[3]), 'Settings are missing or incomplete.'],
      ['bad notBefore', () => variant((f) => (project(f, 'proj-job-setup').notBefore = '2 Nov')), 'Project “Job search setup” has an invalid notBefore.'],
      [
        'details that are not text',
        () => variant((f) => f.tables.logEntries.push({ id: 'bad', completedAt: now.toISOString(), details: { weight: 80 } })),
        /^Log entry \d+ has invalid details\.$/,
      ],
      [
        'waits on a missing project',
        () => variant((f) => (project(f, 'proj-job-setup').startsAfterProjectId = 'gone')),
        "Project “Job search setup” waits on a project that isn't in the file.",
      ],
      [
        'waits on itself',
        () => variant((f) => (project(f, 'proj-job-setup').startsAfterProjectId = 'proj-job-setup')),
        'Project “Job search setup” waits on itself.',
      ],
      [
        'two projects wait on each other',
        () =>
          variant((f) => {
            project(f, 'proj-job-setup').startsAfterProjectId = 'proj-cfa-units'
            project(f, 'proj-cfa-units').startsAfterProjectId = 'proj-job-setup'
          }),
        'Projects wait on each other in a loop: “CFA L1 units” → “Job search setup” → “CFA L1 units”.',
      ],
      [
        'a longer loop',
        () =>
          variant((f) => {
            f.tables.projects.push({ id: 'p3', title: 'Portfolio', goalId: 'goal-job', startsAfterProjectId: 'proj-job-setup' })
            project(f, 'proj-job-setup').startsAfterProjectId = 'proj-cfa-units'
            project(f, 'proj-cfa-units').startsAfterProjectId = 'p3'
          }),
        'Projects wait on each other in a loop: “CFA L1 units” → “Portfolio” → “Job search setup” → “CFA L1 units”.',
      ],
    ])('%s', async (_, make, reason) => {
      const parsed = parseImport(make())
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toMatch(reason)
      expect(await snapshot()).toStrictEqual(before)
    })

    it('a write that fails partway rolls back the whole import', async () => {
      const broken = structuredClone(good)
      broken.tables.logEntries.push(broken.tables.logEntries[0]) // duplicate key: bulkAdd throws after earlier tables were cleared
      await expect(importData(broken, db)).rejects.toThrow()
      expect(await snapshot()).toStrictEqual(before)
      expect(await lastExport(db)).toBeUndefined()
    })
  })
})
