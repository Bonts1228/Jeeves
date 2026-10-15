import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextWeekday } from '../lib/dates'
import { nextDue } from '../lib/repeat'
import type { Task } from '../types'
import { BriefDB } from './db'
import { completeTask, deleteTask, uncompleteTask } from './tasks'

// Local noon on an October 2026 day: 10 Sat, 13 Tue, 14 Wed, 17 Sat, 18 Sun, 25 Sun
const oct = (day: number) => new Date(2026, 9, day, 12)

const task = (extra: Partial<Task>): Task => ({
  id: 't1',
  title: 'Task',
  estimate: 30,
  areaId: 'area-focus',
  status: 'backlog',
  rollovers: 0,
  delegable: false,
  createdAt: oct(1).toISOString(),
  ...extra,
})
const laundry = task({ id: 'laundry', due: '2026-10-10', repeat: { kind: 'every', days: 8 } })
const meals = task({ id: 'meals', due: '2026-10-18', repeat: { kind: 'weekly', weekday: 0 } })

describe('nextDue', () => {
  it('every N days counts from completion, not the old due date', () => {
    expect(nextDue({ kind: 'every', days: 8 }, '2026-10-13', '2026-10-10')).toBe('2026-10-21')
    expect(nextDue({ kind: 'every', days: 8 }, '2026-10-08', '2026-10-10')).toBe('2026-10-16') // early, too
  })

  it('weekly goes to the next given weekday after completion', () => {
    expect(nextDue({ kind: 'weekly', weekday: 0 }, '2026-10-18', '2026-10-18')).toBe('2026-10-25') // on the day
    expect(nextDue({ kind: 'weekly', weekday: 0 }, '2026-10-21', '2026-10-18')).toBe('2026-10-25') // late
    expect(nextDue({ kind: 'weekly', weekday: 0 }, '2026-10-17', '2026-10-18')).toBe('2026-10-25') // early: not the 18th again
  })

  it('nextWeekday is strictly after the date', () => {
    expect(nextWeekday('2026-10-18', 0)).toBe('2026-10-25')
    expect(nextWeekday('2026-10-17', 0)).toBe('2026-10-18')
  })
})

describe('repeating tasks', () => {
  let db: BriefDB
  beforeEach(async () => {
    db = new BriefDB(`test-${crypto.randomUUID()}`)
    await db.open()
  })
  const open = async () => (await db.tasks.toArray()).filter((t) => t.status === 'backlog' || t.status === 'scheduled')

  it('late laundry comes back 8 days after it was done', async () => {
    await db.tasks.add(laundry)
    await completeTask('laundry', { now: oct(13), db })
    const [next] = await open()
    expect(next).toMatchObject({ title: 'Task', due: '2026-10-21', prevId: 'laundry', status: 'backlog', rollovers: 0 })
    expect(next.id).not.toBe('laundry')
  })

  it('weekly meal plan done on Sunday goes to the following Sunday', async () => {
    await db.tasks.add({ ...meals, status: 'scheduled', date: '2026-10-18', blockId: 'b1', reason: 'Due Sun', rollovers: 2 })
    await completeTask('meals', { now: oct(18), db })
    const [next] = await open()
    expect(next).toMatchObject({ due: '2026-10-25', status: 'backlog', rollovers: 0 })
    expect(next.date).toBeUndefined()
    expect(next.blockId).toBeUndefined()
    expect(next.reason).toBeUndefined()
  })

  it('completing twice creates one next occurrence', async () => {
    await db.tasks.add(laundry)
    await completeTask('laundry', { now: oct(13), db })
    await completeTask('laundry', { now: oct(14), db })
    expect(await open()).toHaveLength(1)
    expect(await db.logEntries.count()).toBe(1)
  })

  it('complete → undo → complete leaves one next occurrence and one LogEntry', async () => {
    await db.tasks.add(laundry)
    await completeTask('laundry', { now: oct(13), db })
    await uncompleteTask('laundry', db)
    expect((await db.tasks.get('laundry'))?.status).toBe('backlog')
    expect(await db.tasks.where('prevId').equals('laundry').count()).toBe(0)
    expect(await db.logEntries.count()).toBe(0)

    await completeTask('laundry', { now: oct(14), db })
    const chained = await db.tasks.where('prevId').equals('laundry').toArray()
    expect(chained).toHaveLength(1)
    expect(chained[0].due).toBe('2026-10-22')
    expect(await db.logEntries.count()).toBe(1)
  })

  it('undo reopens a scheduled task as scheduled', async () => {
    await db.tasks.add({ ...laundry, status: 'scheduled', date: '2026-10-13', blockId: 'b1' })
    await completeTask('laundry', { now: oct(13), db })
    await uncompleteTask('laundry', db)
    expect((await db.tasks.get('laundry'))?.status).toBe('scheduled')
  })

  it('undo keeps a next occurrence that is already done, and re-completing adds none', async () => {
    await db.tasks.add(laundry)
    await completeTask('laundry', { now: oct(13), db })
    const next = (await db.tasks.where('prevId').equals('laundry').first())!
    await completeTask(next.id, { now: oct(21), db })

    await uncompleteTask('laundry', db)
    expect((await db.tasks.get(next.id))?.status).toBe('done')
    await completeTask('laundry', { now: oct(14), db })
    expect(await db.tasks.where('prevId').equals('laundry').count()).toBe(1)
  })

  it('delete ends the series: no next occurrence, now or after re-completing the previous one', async () => {
    await db.tasks.add(laundry)
    await deleteTask('laundry', db)
    expect(await db.tasks.count()).toBe(1)
    expect((await db.tasks.get('laundry'))?.status).toBe('deleted')
    await completeTask('laundry', { now: oct(13), db }) // deleted tasks can't be ticked
    expect(await db.tasks.count()).toBe(1)

    await db.tasks.add(meals)
    await completeTask('meals', { now: oct(18), db })
    const next = (await db.tasks.where('prevId').equals('meals').first())!
    await deleteTask(next.id, db)
    await uncompleteTask('meals', db)
    await completeTask('meals', { now: oct(18), db })
    expect(await db.tasks.where('prevId').equals('meals').toArray()).toMatchObject([{ id: next.id, status: 'deleted' }])
  })
})

describe('completeTask logging', () => {
  let db: BriefDB
  beforeEach(async () => {
    db = new BriefDB(`test-${crypto.randomUUID()}`)
    await db.open()
  })

  it("logs against the task's goal, else its project's goal", async () => {
    await db.projects.add({ id: 'p', title: 'Job search setup', areaId: 'area-focus', goalId: 'goal-job' })
    await db.tasks.bulkAdd([task({ id: 'a', goalId: 'goal-x' }), task({ id: 'b', projectId: 'p' }), task({ id: 'c' })])
    for (const id of ['a', 'b', 'c']) await completeTask(id, { now: oct(13), db })
    const goals = Object.fromEntries((await db.logEntries.toArray()).map((e) => [e.taskId, e.goalId]))
    expect(goals).toEqual({ a: 'goal-x', b: 'goal-job', c: undefined })
  })

  it('stores detail fields and creates no next occurrence for a one-off task', async () => {
    await db.tasks.add(task({ id: 'a', goalId: 'goal-job' }))
    await completeTask('a', { details: { role: 'Analyst', company: 'Acme' }, now: oct(13), db })
    expect((await db.logEntries.toArray())[0].details).toEqual({ role: 'Analyst', company: 'Acme' })
    expect(await db.tasks.count()).toBe(1)
  })

  it('a task for a goal served by blocks counts only when done outside a block of its area', async () => {
    await db.goals.add({ id: 'lift', title: 'Lifting', type: 'recurring', areaId: 'area-gym', target: 5, period: 'week', servedByBlocks: true })
    const base = { date: '2026-10-13', protected: false, start: '17:30', end: '19:00' }
    await db.blocks.bulkAdd([
      { id: 'gym', areaId: 'area-gym', ...base },
      { id: 'focus', areaId: 'area-focus', ...base, start: '08:00', end: '12:00' },
    ])
    await db.tasks.bulkAdd([
      task({ id: 'in-gym', goalId: 'lift', status: 'scheduled', date: '2026-10-13', blockId: 'gym' }),
      task({ id: 'in-focus', goalId: 'lift', status: 'scheduled', date: '2026-10-13', blockId: 'focus' }),
      task({ id: 'unscheduled', goalId: 'lift' }),
    ])
    for (const id of ['in-gym', 'in-focus', 'unscheduled']) await completeTask(id, { now: oct(13), db })
    const goals = Object.fromEntries((await db.logEntries.toArray()).map((e) => [e.taskId, e.goalId]))
    expect(goals).toEqual({ 'in-gym': undefined, 'in-focus': 'lift', unscheduled: 'lift' })
  })
})
