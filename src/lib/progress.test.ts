import { describe, expect, it } from 'vitest'
import { buildSeed } from '../db/seed-data'
import type { LogEntry, Task } from '../types'
import { cleanDetails, detailsText, expectedBy, goalNumber, lastDetails, nextStep, paceLabel, periodLeft, periodStart, projectNumber } from './progress'

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

  it('lifting counts its ticked blocks this week', () => {
    expect(goalNumber(goal('goal-lifting'), seed.tasks, [], now)).toBe('0 of 5 this week')
    const logs = [log('goal-lifting', 11, { blockId: 'sat' }), log('goal-lifting', 13, { blockId: 'tue' })]
    expect(goalNumber(goal('goal-lifting'), seed.tasks, logs, now)).toBe('1 of 5 this week')
  })

  it('counts the whole period, so an entry a moment after the display clock still counts', () => {
    const justTicked = log('goal-job', 15, { completedAt: new Date(now.getTime() + 20_000).toISOString() })
    const nextWeek = log('goal-job', 19)
    expect(goalNumber(goal('goal-job'), seed.tasks, [justTicked, nextWeek], now)).toBe('1 of 20 this week')
  })

  it('an open path with no target counts what is done; its projects count their steps', () => {
    const tasks: Task[] = seed.tasks.map((t) => (t.title.startsWith('M7') ? { ...t, status: 'done' } : t))
    expect(goalNumber(goal('goal-code'), tasks, [log('goal-code', 14)], now)).toBe('1 done')
    expect(projectNumber(project('proj-jeeves'), tasks)).toBe('1 of 6 steps')
    expect(nextStep(tasks.filter((t) => t.projectId === 'proj-jeeves'))?.title).toBe('M8 Capture')
  })

  it("an open path counts this period's log entries, including steps of projects that feed it", () => {
    const logs = [log('goal-job', 9), log('goal-job', 13), log('goal-job', 14, { taskId: 'cv' }), log('goal-other', 14)]
    expect(goalNumber(goal('goal-job'), seed.tasks, logs, now)).toBe('2 of 20 this week')
  })

  it('projects count steps (manual-only ones what is open); Housekeeping counts all its open tasks', () => {
    expect(projectNumber(project('proj-job-setup'), seed.tasks)).toBe('0 of 5 steps')
    expect(projectNumber(project('proj-trellis'), seed.tasks)).toBe('0 of 1 step')
    expect(projectNumber({ ...project('proj-motorbike'), manualOnly: true }, seed.tasks)).toBe('4 open')
    expect(goalNumber(goal('goal-housekeeping'), seed.tasks, [], now)).toBe('9 open') // 5 of its own + 4 motorbike steps
  })
})

describe('pace', () => {
  it('expects an even share of the target by each day', () => {
    expect(expectedBy(5, 'week', '2026-10-12')).toBe(1) // Mon, through the day: ceil(5/7)
    expect(expectedBy(5, 'week', '2026-10-12', false)).toBe(0) // Mon morning: nothing yet
    expect(expectedBy(5, 'week', '2026-10-15', false)).toBe(3) // Thu morning: 3 days done, ceil(15/7)
    expect(expectedBy(5, 'week', '2026-10-18')).toBe(5) // Sunday night: all of it
    expect(expectedBy(31, 'month', '2026-10-15', false)).toBe(14)
  })

  it('days left in the period include today', () => {
    expect(periodLeft('week', now)).toBe('4 days left') // Thu: Thu–Sun
    expect(periodLeft('week', new Date(2026, 9, 18, 21))).toBe('last day')
    expect(periodLeft('month', now)).toBe('17 days left')
  })

  it('shows behind as a number, and nothing when on pace', () => {
    const lifting = goal('goal-lifting')
    expect(paceLabel(lifting, [log('goal-lifting', 13)], now)).toBe('2 behind · 4 days left')
    const three = [12, 13, 14].map((d) => log('goal-lifting', d))
    expect(paceLabel(lifting, three, now)).toBe('4 days left')
    expect(paceLabel(goal('goal-code'), [], now)).toBeNull() // no target
  })
})

describe('details', () => {
  it('keeps only the fields filled in, and nothing if none were', () => {
    expect(cleanDetails({ role: ' Analyst ', company: '' })).toEqual({ role: 'Analyst' })
    expect(cleanDetails({ role: ' ', company: '' })).toBeUndefined()
  })

  it("shows details in the goal's field order, and the latest ones for the Backlog", () => {
    expect(detailsText(goal('goal-job'), { company: 'Acme', role: 'Analyst' })).toBe('Analyst, Acme')
    const logs = [
      log('goal-job', 13, { details: { role: 'Analyst', company: 'Acme' } }),
      log('goal-job', 14, { details: { role: 'Engineer' } }),
      log('goal-job', 15), // skipped: no details
    ]
    expect(lastDetails(goal('goal-job'), logs)).toBe('Engineer')
    expect(lastDetails(goal('goal-lifting'), logs)).toBe('')
  })
})
