import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { BriefDB } from './db'
import { deleteGoalOrProject, saveProject } from './goals'
import { completeTask, deleteTask, uncompleteTask, updateTask } from './tasks'

// Portfolio waits on Job setup; it starts (the wait clears) once every Job setup step is done or deleted.
const now = new Date(2026, 9, 15, 12)
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  estimate: 30,
  areaId: 'focus',
  projectId: 'setup',
  status: 'backlog',
  rollovers: 0,
  delegable: false,
  createdAt: now.toISOString(),
  ...extra,
})

let db: BriefDB
const waiting = async () => (await db.projects.get('portfolio'))?.startsAfterProjectId

beforeEach(async () => {
  db = new BriefDB(`test-${crypto.randomUUID()}`)
  await db.open()
  await db.goals.add({ id: 'job', title: 'Job', type: 'open_path', areaId: 'focus' })
  await db.projects.bulkAdd([
    { id: 'setup', title: 'Job setup', areaId: 'focus' },
    { id: 'portfolio', title: 'Portfolio', areaId: 'focus', startsAfterProjectId: 'setup' },
  ])
  await db.tasks.bulkAdd([task('cv', { order: 1 }), task('linkedin', { order: 2 })])
})

describe('startsAfterProjectId', () => {
  it('clears when the last open step is done, not before; undo done does not bring it back', async () => {
    await completeTask('cv', { now, db })
    expect(await waiting()).toBe('setup')
    await completeTask('linkedin', { now, db })
    expect(await waiting()).toBeUndefined()
    await uncompleteTask('linkedin', db)
    expect(await waiting()).toBeUndefined()
  })

  it('clears when the last open step is deleted or moved out', async () => {
    await deleteTask('cv', db)
    expect(await waiting()).toBe('setup')
    await updateTask('linkedin', { projectId: undefined }, undefined, { now, db })
    expect(await waiting()).toBeUndefined()
  })

  it('never clears while a repeating step goes on', async () => {
    await db.tasks.update('linkedin', { due: '2026-10-16', repeat: { kind: 'every', days: 7 } })
    await completeTask('cv', { now, db })
    await completeTask('linkedin', { now, db }) // makes the next occurrence
    expect(await waiting()).toBe('setup')
  })

  it('clears when the project waited on is deleted', async () => {
    await deleteGoalOrProject('project', 'setup', 'keep', db)
    expect(await waiting()).toBeUndefined()
  })

  it("clears when deleting a goal deletes the project's last open steps", async () => {
    await db.tasks.bulkUpdate([
      { key: 'cv', changes: { goalId: 'job' } },
      { key: 'linkedin', changes: { goalId: 'job' } },
    ])
    await deleteGoalOrProject('goal', 'job', 'delete', db)
    expect(await waiting()).toBeUndefined()
  })

  it('is not kept when saved against a project with nothing open', async () => {
    await saveProject({ id: 'later', title: 'Later', areaId: 'focus', startsAfterProjectId: 'portfolio', notBefore: '2026-11-02' }, db)
    expect(await db.projects.get('later')).toEqual({ id: 'later', title: 'Later', areaId: 'focus', notBefore: '2026-11-02' })
    await saveProject({ id: 'later2', title: 'Later 2', areaId: 'focus', startsAfterProjectId: 'setup' }, db)
    expect((await db.projects.get('later2'))?.startsAfterProjectId).toBe('setup')
  })
})
