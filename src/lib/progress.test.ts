import { describe, expect, it } from 'vitest'
import { buildSeed } from '../db/seed-data'
import type { LogEntry, Task } from '../types'
import { goalNumber, nextStep, periodStart, projectNumber } from './progress'

const now = new Date(2026, 9, 15, 12) // Thu 15 Oct 2026
const seed = buildSeed(now)
const goal = (id: string) => seed.goals.find((g) => g.id === id)!
const project = (id: string) => seed.projects.find((p) => p.id === id)!
const log = (goalId: string, day: number, extra: Partial<LogEntry> = {}): LogEntry => ({
  id: `${goalId}-${day}`,
  goalId,
  completedAt: new Date(2026, 9, day, 12).toISOString(),
  ...extra,
})

describe('Backlog numbers', () => {
  it('weeks start on Monday, months on the 1st', () => {
    expect(periodStart('week', now)).toEqual(new Date(2026, 9, 12))
    expect(periodStart('week', new Date(2026, 9, 18, 23))).toEqual(new Date(2026, 9, 12)) // Sunday
    expect(periodStart('month', now)).toEqual(new Date(2026, 9, 1))
  })

  it('lifting shows 0 of 5 this week: nothing logs block completions until M4', () => {
    expect(goalNumber(goal('goal-lifting'), seed.tasks, [], now)).toBe('0 of 5 this week')
  })

  it('a set path counts its steps', () => {
    const tasks: Task[] = seed.tasks.map((t) => (t.title.startsWith('M2') ? { ...t, status: 'done' } : t))
    expect(goalNumber(goal('goal-jeeves'), tasks, [], now)).toBe('2 of 10 steps')
    expect(nextStep(tasks.filter((t) => t.goalId === 'goal-jeeves'))?.title).toBe('M3 Brief (1/2)')
  })

  it("an open path counts this period's log entries, including steps of projects that feed it", () => {
    const logs = [log('goal-job', 9), log('goal-job', 13), log('goal-job', 14, { taskId: 'cv' }), log('goal-other', 14)]
    expect(goalNumber(goal('goal-job'), seed.tasks, logs, now)).toBe('2 of 20 this week')
  })

  it('projects: ordered ones count steps, Housekeeping counts what is open', () => {
    expect(projectNumber(project('proj-job-setup'), seed.tasks)).toBe('0 of 5 steps')
    expect(projectNumber(project('proj-housekeeping'), seed.tasks)).toBe('5 open')
    expect(goalNumber(goal('goal-trellis'), seed.tasks, [], now)).toBe('0 of 1 step')
  })
})
