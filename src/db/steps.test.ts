import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { goalProgress } from '../lib/progress'
import { type Goal, HOUSEKEEPING_ID, type Task } from '../types'
import { BriefDB } from './db'
import { affectedBy, deleteGoalOrProject, saveGoal, saveProject } from './goals'
import { moveStep, stepsOf } from './steps'
import { addTask, completeTask, deleteTask, uncompleteTask, updateTask } from './tasks'

const now = new Date(2026, 9, 15, 12) // Thu 15 Oct 2026
let seq = 0
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  goalId: 'g-none', // no such goal row: not Housekeeping, so not manual-only
  title: id,
  estimate: 30,
  areaId: 'area-focus',
  status: 'backlog',
  rollovers: 0,
  delegable: false,
  createdAt: new Date(2026, 9, 1, 0, seq++).toISOString(),
  ...extra,
})
const launch: Goal = { id: 'g', title: 'Launch', type: 'open_path', areaId: 'area-focus' }

let db: BriefDB
beforeEach(async () => {
  db = new BriefDB(`test-${crypto.randomUUID()}`)
  await db.open()
  await db.goals.put(launch)
  await db.projects.bulkPut([
    { id: 'p', title: 'Job search setup', goalId: 'job' },
    { id: 'house', title: 'Housekeeping', goalId: 'g-none', manualOnly: true },
    { id: 'p2', title: 'Launch steps', goalId: 'g' },
  ])
})

const titles = async (list: { goalId: string } | { projectId: string }) =>
  (await stepsOf(list, db)).map((t) => `${t.order}:${t.id}${t.status === 'done' ? '✓' : ''}`)
const addSteps = async (list: Partial<Task>, ids: string[]) => {
  for (const id of ids) await addTask(task(id, list), { db })
}

describe('step order stays 1..n', () => {
  beforeEach(() => addSteps({ projectId: 'p' }, ['cv', 'linkedin', 'firms', 'tracker', 'outreach']))

  it('new steps go last', async () => {
    expect(await titles({ projectId: 'p' })).toEqual(['1:cv', '2:linkedin', '3:firms', '4:tracker', '5:outreach'])
  })

  it('up/down swaps neighbours; the ends stay put', async () => {
    await moveStep('firms', -1, db)
    expect(await titles({ projectId: 'p' })).toEqual(['1:cv', '2:firms', '3:linkedin', '4:tracker', '5:outreach'])
    await moveStep('cv', -1, db)
    await moveStep('outreach', 1, db)
    expect(await titles({ projectId: 'p' })).toEqual(['1:cv', '2:firms', '3:linkedin', '4:tracker', '5:outreach'])
  })

  it('delete closes the gap', async () => {
    await deleteTask('linkedin', db)
    expect(await titles({ projectId: 'p' })).toEqual(['1:cv', '2:firms', '3:tracker', '4:outreach'])
    expect((await db.tasks.get('linkedin'))?.order).toBeUndefined()
  })

  it('done steps keep their place; moving skips over them', async () => {
    await completeTask('linkedin', { now, db })
    expect(await titles({ projectId: 'p' })).toEqual(['1:cv', '2:linkedin✓', '3:firms', '4:tracker', '5:outreach'])
    await moveStep('firms', -1, db) // past the done step, swaps with cv
    expect(await titles({ projectId: 'p' })).toEqual(['1:firms', '2:linkedin✓', '3:cv', '4:tracker', '5:outreach'])
    await uncompleteTask('linkedin', db)
    expect(await titles({ projectId: 'p' })).toEqual(['1:firms', '2:linkedin', '3:cv', '4:tracker', '5:outreach'])
  })

  it("a repeating step's next occurrence goes last; undo closes the gap", async () => {
    await updateTask('cv', { due: '2026-10-15', repeat: { kind: 'every', days: 30 } }, undefined, { now, db })
    await completeTask('cv', { now, db })
    const next = (await db.tasks.where('prevId').equals('cv').first())!
    expect(await titles({ projectId: 'p' })).toEqual([
      '1:cv✓',
      '2:linkedin',
      '3:firms',
      '4:tracker',
      '5:outreach',
      `6:${next.id}`,
    ])
    await uncompleteTask('cv', db)
    expect(await titles({ projectId: 'p' })).toEqual(['1:cv', '2:linkedin', '3:firms', '4:tracker', '5:outreach'])
  })

  it('moving a step to another project closes the gap, puts it last there and takes that goal', async () => {
    await addSteps({ projectId: 'p2' }, ['spec', 'build'])
    await updateTask('linkedin', { projectId: 'p2' }, undefined, { now, db })
    expect(await titles({ projectId: 'p' })).toEqual(['1:cv', '2:firms', '3:tracker', '4:outreach'])
    expect(await titles({ projectId: 'p2' })).toEqual(['1:spec', '2:build', '3:linkedin'])
    expect((await db.tasks.get('linkedin'))?.goalId).toBe('g')
  })

  it('moving a step out to its goal leaves it unordered there', async () => {
    await updateTask('linkedin', { projectId: undefined, goalId: 'job' }, undefined, { now, db })
    expect(await titles({ projectId: 'p' })).toEqual(['1:cv', '2:firms', '3:tracker', '4:outreach'])
    expect(await titles({ goalId: 'job' })).toEqual(['undefined:linkedin'])
  })

  it('manual-only projects have no order; toggling numbers or clears them', async () => {
    await addSteps({ projectId: 'house' }, ['laundry', 'shop'])
    expect((await stepsOf({ projectId: 'house' }, db)).map((t) => t.order)).toEqual([undefined, undefined])
    await saveProject({ id: 'p', title: 'Job search setup', goalId: 'job', manualOnly: true }, db)
    expect((await stepsOf({ projectId: 'p' }, db)).every((t) => t.order === undefined)).toBe(true)
    await saveProject({ id: 'house', title: 'Housekeeping', goalId: 'g-none' }, db)
    expect(await titles({ projectId: 'house' })).toEqual(['1:laundry', '2:shop'])
  })
})

describe('saving a goal', () => {
  it("a goal's own tasks have no order", async () => {
    await addSteps({ goalId: 'g' }, ['a', 'b'])
    expect((await db.tasks.toArray()).map((t) => t.order)).toEqual([undefined, undefined])
    await moveStep('b', -1, db)
    expect(await titles({ goalId: 'g' })).toEqual(['undefined:a', 'undefined:b'])
  })

  it('servedByBlocks only stays on recurring', async () => {
    await saveGoal({ ...launch, type: 'recurring', target: 5, period: 'week', servedByBlocks: true }, db)
    expect(await db.goals.get('g')).toMatchObject({ servedByBlocks: true, target: 5 })
    await saveGoal({ ...launch, type: 'open_path', target: 5, period: 'week', servedByBlocks: true }, db)
    expect((await db.goals.get('g'))?.servedByBlocks).toBeUndefined()
  })

  it('Housekeeping stays the system goal: open path, no target', async () => {
    const house: Goal = { id: HOUSEKEEPING_ID, title: 'Home admin', type: 'open_path', areaId: 'area-gym', isHousekeeping: true }
    await saveGoal({ ...house, type: 'recurring', target: 3, period: 'week', isHousekeeping: undefined }, db)
    expect(await db.goals.get(HOUSEKEEPING_ID)).toEqual(house)
    await saveGoal({ ...launch, isHousekeeping: true }, db)
    expect((await db.goals.get('g'))?.isHousekeeping).toBeUndefined()
  })

  it('moving a project to another goal takes its tasks along', async () => {
    await addSteps({ projectId: 'p' }, ['cv', 'linkedin'])
    await completeTask('cv', { now, db })
    await saveProject({ id: 'p', title: 'Job search setup', goalId: 'g' }, db)
    expect((await db.tasks.where('projectId').equals('p').toArray()).map((t) => t.goalId)).toEqual(['g', 'g'])
  })
})

describe('deleting a goal or project', () => {
  beforeEach(async () => {
    await addSteps({ projectId: 'p' }, ['cv', 'linkedin', 'firms'])
    await completeTask('cv', { now, db })
    await db.goals.put({ id: 'job', title: 'Secure a job', type: 'open_path', areaId: 'area-focus', target: 5, period: 'week' })
    await addSteps({ goalId: 'job' }, ['app1', 'app2'])
  })

  it('counts what is affected', async () => {
    expect(await affectedBy('project', 'p', db)).toEqual({ open: 2, done: 1, projects: 0, waiting: 0 })
    expect(await affectedBy('goal', 'job', db)).toEqual({ open: 2, done: 0, projects: 1, waiting: 0 })
  })

  it("'keep' on a project leaves its tasks under the goal, unordered", async () => {
    await deleteGoalOrProject('project', 'p', 'keep', db)
    const tasks = await db.tasks.where('id').anyOf('cv', 'linkedin', 'firms').toArray()
    expect(tasks.map((t) => [t.id, t.status, t.goalId, t.projectId, t.order])).toEqual([
      ['cv', 'done', 'job', undefined, undefined],
      ['firms', 'backlog', 'job', undefined, undefined],
      ['linkedin', 'backlog', 'job', undefined, undefined],
    ])
    expect(await db.projects.get('p')).toBeUndefined()
  })

  it("'keep' on a goal moves its tasks and projects to Housekeeping", async () => {
    await deleteGoalOrProject('goal', 'job', 'keep', db)
    expect((await db.tasks.where('id').anyOf('app1', 'app2').toArray()).map((t) => [t.status, t.goalId])).toEqual([
      ['backlog', HOUSEKEEPING_ID],
      ['backlog', HOUSEKEEPING_ID],
    ])
    expect((await db.projects.get('p'))?.goalId).toBe(HOUSEKEEPING_ID)
    expect(await titles({ projectId: 'p' })).toEqual(['1:cv✓', '2:linkedin', '3:firms']) // steps keep their order
    expect((await db.tasks.where('projectId').equals('p').toArray()).every((t) => t.goalId === HOUSEKEEPING_ID)).toBe(true)
  })

  it("'delete' on a goal deletes its open tasks; history and log entries stay", async () => {
    const logs = await db.logEntries.toArray()
    await deleteGoalOrProject('goal', 'job', 'delete', db)
    expect((await db.tasks.where('id').anyOf('app1', 'app2').toArray()).map((t) => [t.status, t.goalId])).toEqual([
      ['deleted', HOUSEKEEPING_ID],
      ['deleted', HOUSEKEEPING_ID],
    ])
    expect((await db.tasks.get('linkedin'))?.status).toBe('backlog') // its project's steps move, not deleted
    expect(await db.logEntries.toArray()).toEqual(logs)
  })

  it('Housekeeping cannot be deleted', async () => {
    await db.goals.put({ id: HOUSEKEEPING_ID, title: 'Housekeeping', type: 'open_path', areaId: 'area-focus', isHousekeeping: true })
    await deleteGoalOrProject('goal', HOUSEKEEPING_ID, 'delete', db)
    expect(await db.goals.get(HOUSEKEEPING_ID)).toBeDefined()
  })
})

describe('changing target or period', () => {
  it('never rewrites log entries; progress recomputes', async () => {
    const goal: Goal = { id: 'job', title: 'Secure a job', type: 'open_path', areaId: 'area-focus', target: 5, period: 'week' }
    await db.goals.put(goal)
    await addSteps({ goalId: 'job' }, ['a', 'b', 'c'])
    await completeTask('a', { now: new Date(2026, 9, 2, 12), db }) // Fri 2 Oct: last week, this month
    await completeTask('b', { now: new Date(2026, 9, 13, 12), db }) // Tue 13 Oct: this week
    await completeTask('c', { now: new Date(2026, 9, 14, 12), db }) // Wed 14 Oct: this week
    const logs = await db.logEntries.toArray()
    expect(goalProgress(goal, logs, now)).toEqual({ done: 2, target: 5 })

    await saveGoal({ ...goal, target: 20, period: 'month' }, db)
    expect(await db.logEntries.toArray()).toEqual(logs)
    expect(goalProgress((await db.goals.get('job'))!, logs, now)).toEqual({ done: 3, target: 20 })
  })
})
