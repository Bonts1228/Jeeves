import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { HOUSEKEEPING_ID } from '../types'
import { BriefDB } from './db'
import { migrateTables, toV5 } from './migrations'

type Row = Record<string, unknown>

const task = (id: string, extra: Row = {}): Row => ({
  id,
  title: id,
  estimate: 30,
  areaId: 'area-focus',
  status: 'backlog',
  rollovers: 0,
  delegable: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...extra,
})

// A v4 device: set-path goals, the seeded Housekeeping project, a project with no goal, loose and
// orphaned tasks, and an Inbox item.
const v4 = () => ({
  areas: [{ id: 'area-focus', name: 'Focus' }, { id: 'area-gym', name: 'Gym' }],
  goals: [
    { id: 'goal-jeeves', title: 'Launch Jeeves', type: 'set_path', areaId: 'area-focus', deadline: '2026-11-30' },
    { id: 'goal-job', title: 'Secure a job', type: 'open_path', areaId: 'area-focus', target: 20, period: 'week' },
  ] as Row[],
  projects: [
    { id: 'proj-housekeeping', title: 'Housekeeping', areaId: 'area-focus', manualOnly: true },
    { id: 'proj-job-setup', title: 'Job search setup', areaId: 'area-focus', goalId: 'goal-job', startsAfterProjectId: 'proj-housekeeping' },
    { id: 'proj-loose', title: 'Garden', areaId: 'area-gym' },
  ] as Row[],
  tasks: [
    task('m1', { goalId: 'goal-jeeves', order: 1, status: 'done' }),
    task('m2', { goalId: 'goal-jeeves', order: 2 }),
    task('laundry', { projectId: 'proj-housekeeping' }),
    task('cv', { projectId: 'proj-job-setup', order: 1 }),
    task('app', { goalId: 'goal-job' }),
    task('loose'),
    task('orphan', { goalId: 'goal-gone', order: 3 }),
    task('weed', { projectId: 'proj-loose' }),
  ],
})
const inbox = [{ id: 'in1', text: 'Call the bank', createdAt: '2026-10-05T09:00:00.000Z' }]

const byId = (rows: Row[]) => new Map(rows.map((r) => [r.id, r]))

describe('toV5', () => {
  it('turns a set-path goal into an open path with a project holding its steps, in order', () => {
    const t = v4()
    toV5(t)
    const goal = byId(t.goals).get('goal-jeeves')!
    expect(goal).toMatchObject({ type: 'open_path', deadline: '2026-11-30' })
    expect(byId(t.projects).get('proj-from-goal-jeeves')).toEqual({
      id: 'proj-from-goal-jeeves',
      title: 'Launch Jeeves',
      goalId: 'goal-jeeves',
    })
    const tasks = byId(t.tasks)
    expect(tasks.get('m1')).toMatchObject({ goalId: 'goal-jeeves', projectId: 'proj-from-goal-jeeves', order: 1, status: 'done' })
    expect(tasks.get('m2')).toMatchObject({ goalId: 'goal-jeeves', projectId: 'proj-from-goal-jeeves', order: 2 })
  })

  it('makes the Housekeeping goal and dissolves the old Housekeeping project into it', () => {
    const t = v4()
    toV5(t)
    expect(byId(t.goals).get(HOUSEKEEPING_ID)).toEqual({
      id: HOUSEKEEPING_ID,
      title: 'Housekeeping',
      type: 'open_path',
      areaId: 'area-focus',
      isHousekeeping: true,
    })
    expect(byId(t.projects).has('proj-housekeeping')).toBe(false)
    expect(byId(t.tasks).get('laundry')).toEqual(task('laundry', { goalId: HOUSEKEEPING_ID }))
    // A wait on the dissolved project is over
    expect(byId(t.projects).get('proj-job-setup')).toEqual({ id: 'proj-job-setup', title: 'Job search setup', goalId: 'goal-job' })
  })

  it('gives every project and task a goal that exists, and project tasks their project’s goal', () => {
    const t = v4()
    toV5(t)
    const goals = new Set(t.goals.map((g) => g.id))
    const projectGoal = new Map(t.projects.map((p) => [p.id, p.goalId]))
    for (const p of t.projects) {
      expect(goals.has(p.goalId)).toBe(true)
      expect(p).not.toHaveProperty('areaId')
    }
    for (const x of t.tasks) {
      expect(goals.has(x.goalId)).toBe(true)
      if (x.projectId) expect(x.goalId).toBe(projectGoal.get(x.projectId))
      else expect(x).not.toHaveProperty('order')
    }
    const tasks = byId(t.tasks)
    expect(tasks.get('cv')).toMatchObject({ goalId: 'goal-job', projectId: 'proj-job-setup', order: 1 })
    expect(tasks.get('loose')!.goalId).toBe(HOUSEKEEPING_ID)
    expect(tasks.get('orphan')!.goalId).toBe(HOUSEKEEPING_ID)
    expect(tasks.get('weed')).toMatchObject({ goalId: HOUSEKEEPING_ID, projectId: 'proj-loose', areaId: 'area-focus' })
  })

  it('turns Inbox items into Housekeeping tasks with the capture defaults', () => {
    const t = v4()
    toV5(t, inbox)
    expect(byId(t.tasks).get('in1')).toEqual({
      id: 'in1',
      title: 'Call the bank',
      estimate: 30,
      areaId: 'area-focus',
      goalId: HOUSEKEEPING_ID,
      status: 'backlog',
      rollovers: 0,
      delegable: false,
      createdAt: '2026-10-05T09:00:00.000Z',
    })
  })

  it('without an old Housekeeping project, puts the goal in the first area', () => {
    const t = { areas: [{ id: 'a1' }], goals: [], projects: [], tasks: [task('x')] }
    toV5(t)
    expect(t.goals).toEqual([{ id: HOUSEKEEPING_ID, title: 'Housekeeping', type: 'open_path', areaId: 'a1', isHousekeeping: true }])
  })

  it('migrateTables consumes an old file’s inbox table', () => {
    const t: Record<string, Row[]> = { ...v4(), inbox: structuredClone(inbox) }
    migrateTables(t, 4)
    expect(t).not.toHaveProperty('inbox')
    expect(t.projects.some((p) => p.id === 'proj-from-goal-jeeves')).toBe(true)
    expect(t.tasks.some((x) => x.id === 'in1')).toBe(true)
  })
})

// The phone's path: a v4 database opened by this app upgrades through Dexie.
describe('Dexie upgrade to v5', () => {
  it('migrates a v4 database in place, inbox included, and drops the inbox table', async () => {
    const name = `test-${crypto.randomUUID()}`
    const old = new Dexie(name)
    old.version(4).stores({
      settings: '',
      areas: 'id',
      blockTemplates: 'id, weekday, areaId',
      blocks: 'id, date, templateId',
      goals: 'id, areaId',
      projects: 'id, areaId, startsAfterProjectId',
      tasks: 'id, status, date, areaId, goalId, projectId, blockId, prevId',
      logEntries: 'id, taskId, blockId, goalId, completedAt',
      inbox: 'id',
      meta: '',
    })
    const rows = v4()
    await old.table('areas').bulkAdd(rows.areas)
    await old.table('goals').bulkAdd(rows.goals)
    await old.table('projects').bulkAdd(rows.projects)
    await old.table('tasks').bulkAdd(rows.tasks)
    await old.table('inbox').bulkAdd(inbox)
    await old.table('logEntries').add({ id: 'l1', taskId: 'm1', goalId: 'goal-jeeves', completedAt: '2026-10-02T10:00:00.000Z' })
    old.close()

    const db = new BriefDB(name)
    await db.open()
    expect(db.verno).toBe(5)
    expect(db.tables.map((t) => t.name)).not.toContain('inbox')
    expect((await db.goals.get('goal-jeeves'))?.type).toBe('open_path')
    expect(await db.goals.get(HOUSEKEEPING_ID)).toMatchObject({ isHousekeeping: true })
    expect(await db.projects.where('goalId').equals('goal-jeeves').primaryKeys()).toEqual(['proj-from-goal-jeeves'])
    expect(await db.tasks.get('in1')).toMatchObject({ title: 'Call the bank', goalId: HOUSEKEEPING_ID })
    expect((await db.tasks.toArray()).every((t) => !!t.goalId)).toBe(true)
    // History is untouched
    expect(await db.logEntries.get('l1')).toMatchObject({ goalId: 'goal-jeeves' })
    db.close()
  })
})
