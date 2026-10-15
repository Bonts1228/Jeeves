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

// A device with more than the seed: inbox, generated and one-off blocks, done tasks, logs (incl. a
// block tick), a repeat chain
async function lived() {
  await seed(db, now)
  await db.inbox.add({ id: 'in1', text: 'Call the bank', createdAt: now.toISOString() })
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
    expect(parsed.summary).toMatchObject({ fromVersion: SCHEMA_VERSION, goals: 4, projects: 2, inbox: 1 })
    await importData(parsed.file, db)
    expect(await snapshot()).toStrictEqual(before)
    expect(await lastExport(db)).toBe(now.toISOString())
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
    await db.projects.add({ id: 'p3', title: 'Portfolio', areaId: 'area-focus', notBefore: '2026-11-02', startsAfterProjectId: 'proj-job-setup' })
    const before = await snapshot()
    const parsed = parseImport(JSON.stringify(await exportData(db, now)))
    if (!parsed.ok) throw new Error(parsed.reason)
    await seed(db, now)
    await importData(parsed.file, db)
    expect(await snapshot()).toStrictEqual(before)
    expect(await db.projects.get('p3')).toMatchObject({ notBefore: '2026-11-02', startsAfterProjectId: 'proj-job-setup' })
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

    it.each([
      ['not JSON', () => '{"app": "daily-brief", "tables": [', "This isn't a valid JSON file."],
      ['another app', () => variant((f) => (f.app = 'todoist')), "This isn't a Daily Brief export."],
      ['newer version', () => variant((f) => (f.schemaVersion = 99)), /newer version of the app \(schema 99/],
      ['missing table', () => variant((f) => delete f.tables.tasks), 'The tasks table is missing.'],
      ['bad row', () => variant((f) => delete f.tables.tasks[11].title), 'Task 12 has a missing or invalid title.'],
      ['bad status', () => variant((f) => (f.tables.tasks[0].status = 'later')), /^Task 1 \(“.+”\) has a missing or invalid status\.$/],
      ['duplicate ids', () => variant((f) => f.tables.goals.push(f.tables.goals[0])), 'Two goal rows share the id goal-jeeves.'],
      ['bad settings', () => variant((f) => delete f.settings.capacity[3]), 'Settings are missing or incomplete.'],
      ['bad notBefore', () => variant((f) => (f.tables.projects[1].notBefore = '2 Nov')), 'Project “Job search setup” has an invalid notBefore.'],
      [
        'waits on a missing project',
        () => variant((f) => (f.tables.projects[1].startsAfterProjectId = 'gone')),
        "Project “Job search setup” waits on a project that isn't in the file.",
      ],
      [
        'waits on itself',
        () => variant((f) => (f.tables.projects[1].startsAfterProjectId = 'proj-job-setup')),
        'Project “Job search setup” waits on itself.',
      ],
      [
        'two projects wait on each other',
        () =>
          variant((f) => {
            f.tables.projects[0].startsAfterProjectId = 'proj-job-setup'
            f.tables.projects[1].startsAfterProjectId = 'proj-housekeeping'
          }),
        'Projects wait on each other in a loop: “Housekeeping” → “Job search setup” → “Housekeeping”.',
      ],
      [
        'a longer loop',
        () =>
          variant((f) => {
            f.tables.projects.push({ id: 'p3', title: 'Portfolio', areaId: 'area-focus', startsAfterProjectId: 'proj-housekeeping' })
            f.tables.projects[0].startsAfterProjectId = 'proj-job-setup'
            f.tables.projects[1].startsAfterProjectId = 'p3'
          }),
        'Projects wait on each other in a loop: “Housekeeping” → “Job search setup” → “Portfolio” → “Housekeeping”.',
      ],
    ])('%s', async (_, make, reason) => {
      const parsed = parseImport(make())
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toMatch(reason)
      expect(await snapshot()).toStrictEqual(before)
    })

    it('a write that fails partway rolls back the whole import', async () => {
      const broken = structuredClone(good)
      broken.tables.inbox.push(broken.tables.inbox[0]) // duplicate key: bulkAdd throws after earlier tables were cleared
      await expect(importData(broken, db)).rejects.toThrow()
      expect(await snapshot()).toStrictEqual(before)
      expect(await lastExport(db)).toBeUndefined()
    })
  })
})
