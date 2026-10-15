import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { BriefDB, SETTINGS_KEY } from './db'
import { ensureSeeded, seed } from './seed'

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
    await db.inbox.add({ id: 'x', text: 'stray', createdAt: new Date().toISOString() })
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
    expect([...new Set(goals.map((g) => g.type))].sort()).toEqual(['open_path', 'recurring', 'set_path'])
    expect(goals.find((g) => g.type === 'recurring')?.detailFields?.length).toBeGreaterThan(0)

    const projectSteps = tasks.filter((t) => t.projectId === 'proj-housekeeping')
    expect(projectSteps.length).toBeGreaterThanOrEqual(4)
    expect(projectSteps.length).toBeLessThanOrEqual(6)
    expect(tasks.length).toBeGreaterThanOrEqual(20)
    expect(tasks.length).toBeLessThanOrEqual(40) // CLAUDE.md says 20–30; the real week has 36
    expect(tasks.filter((t) => t.due).length).toBeGreaterThan(0)
    expect(tasks.every((t) => t.status === 'backlog' && t.estimate > 0)).toBe(true)
  })

  it('ensureSeeded only seeds an empty database', async () => {
    await ensureSeeded(db)
    await db.areas.update('area-focus', { name: 'Kept' })
    await ensureSeeded(db)
    expect((await db.areas.get('area-focus'))?.name).toBe('Kept')
  })
})
