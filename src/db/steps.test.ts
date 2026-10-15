import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { goalProgress } from '../lib/progress'
import type { Goal, Task } from '../types'
import { BriefDB } from './db'
import { affectedBy, deleteGoalOrProject, saveGoal, saveProject } from './goals'
import { moveStep, stepsOf } from './steps'
import { addTask, completeTask, deleteTask, uncompleteTask, updateTask } from './tasks'

const now = new Date(2026, 9, 15, 12) // Thu 15 Oct 2026
let seq = 0
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  estimate: 30,
  areaId: 'area-focus',
  status: 'backlog',
  rollovers: 0,
  delegable: false,
  createdAt: new Date(2026, 9, 1, 0, seq++).toISOString(),
  ...extra,
})
const setPath: Goal = { id: 'g', title: 'Launch', type: 'set_path', areaId: 'area-focus' }

let db: BriefDB
beforeEach(async () => {
  db = new BriefDB(`test-${crypto.randomUUID()}`)
  await db.open()
  await db.goals.put(setPath)
  await db.projects.bulkPut([
    { id: 'p', title: 'Job search setup', areaId: 'area-focus', goalId: 'job' },
    { id: 'house', title: 'Housekeeping', areaId: 'area-focus', manualOnly: true },
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

  it('moving a step to another list closes the gap and puts it last there', async () => {
    await addSteps({ goalId: 'g' }, ['spec', 'build'])
    await updateTask('linkedin', { projectId: undefined, goalId: 'g' }, undefined, { now, db })
    expect(await titles({ projectId: 'p' })).toEqual(['1:cv', '2:firms', '3:tracker', '4:outreach'])
    expect(await titles({ goalId: 'g' })).toEqual(['1:spec', '2:build', '3:linkedin'])
  })

  it('manual-only projects have no order; toggling numbers or clears them', async () => {
    await addSteps({ projectId: 'house' }, ['laundry', 'shop'])
    expect((await stepsOf({ projectId: 'house' }, db)).map((t) => t.order)).toEqual([undefined, undefined])
    await saveProject({ id: 'p', title: 'Job search setup', areaId: 'area-focus', manualOnly: true }, db)
    expect((await stepsOf({ projectId: 'p' }, db)).every((t) => t.order === undefined)).toBe(true)
    await saveProject({ id: 'house', title: 'Housekeeping', areaId: 'area-focus' }, db)
    expect(await titles({ projectId: 'house' })).toEqual(['1:laundry', '2:shop'])
  })
})

describe('goal type change', () => {
  beforeEach(() => addSteps({ goalId: 'g' }, ['a', 'b', 'c']))

  it('set path → open path clears the order; back to set path numbers oldest first', async () => {
    await moveStep('c', -1, db)
    expect(await titles({ goalId: 'g' })).toEqual(['1:a', '2:c', '3:b'])
    await saveGoal({ ...setPath, type: 'open_path', target: 5, period: 'week' }, db)
    expect((await db.tasks.toArray()).map((t) => t.order)).toEqual([undefined, undefined, undefined])
    await saveGoal(setPath, db)
    expect(await titles({ goalId: 'g' })).toEqual(['1:a', '2:b', '3:c'])
  })

  it('becoming a set path drops target and period; servedByBlocks only stays on recurring', async () => {
    await saveGoal({ ...setPath, type: 'recurring', target: 5, period: 'week', servedByBlocks: true }, db)
    expect(await db.goals.get('g')).toMatchObject({ servedByBlocks: true, target: 5 })
    await saveGoal({ ...setPath, type: 'open_path', target: 5, period: 'week', servedByBlocks: true }, db)
    expect((await db.goals.get('g'))?.servedByBlocks).toBeUndefined()
    await saveGoal({ ...setPath, target: 5, period: 'week' }, db)
    expect(await db.goals.get('g')).toEqual(setPath)
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

  it("'keep' leaves open tasks as loose Backlog tasks", async () => {
    await deleteGoalOrProject('project', 'p', 'keep', db)
    const tasks = await db.tasks.where('id').anyOf('cv', 'linkedin', 'firms').toArray()
    expect(tasks.map((t) => [t.id, t.status, t.projectId, t.order])).toEqual([
      ['cv', 'done', undefined, undefined],
      ['firms', 'backlog', undefined, undefined],
      ['linkedin', 'backlog', undefined, undefined],
    ])
    expect(await db.projects.get('p')).toBeUndefined()
  })

  it("'delete' deletes open tasks, keeps done ones as history; feeding projects are unlinked", async () => {
    const logs = await db.logEntries.toArray()
    await deleteGoalOrProject('goal', 'job', 'delete', db)
    expect((await db.tasks.where('id').anyOf('app1', 'app2').toArray()).map((t) => [t.status, t.goalId])).toEqual([
      ['deleted', undefined],
      ['deleted', undefined],
    ])
    expect((await db.projects.get('p'))?.goalId).toBeUndefined()
    expect(await db.logEntries.toArray()).toEqual(logs)
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
