// The owner's real week.
// IDs are stable strings so re-running the seed always produces the same rows.
// Created/due dates are relative to the day the seed runs; goal deadlines are fixed.

import { isoDate } from '../lib/dates'
import { type Area, type BlockTemplate, type Goal, HOUSEKEEPING_ID, type Project, type Settings, type Task, type Weekday } from '../types'

export interface SeedData {
  settings: Settings
  areas: Area[]
  blockTemplates: BlockTemplate[]
  goals: Goal[]
  projects: Project[]
  tasks: Task[]
}

const AREA = { focus: 'area-focus', social: 'area-social', gym: 'area-gym' }

export function buildSeed(today = new Date()): SeedData {
  const dayOffset = (n: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() + n)
    return d
  }
  const due = (n: number) => isoDate(dayOffset(n))
  const created = (n: number) => dayOffset(-n).toISOString()
  const nextSunday = 7 - today.getDay() // 1–7 days ahead; a week on if today is Sunday

  const settings: Settings = {
    briefTime: '21:00',
    capacity: { 0: 180, 1: 540, 2: 540, 3: 540, 4: 540, 5: 420, 6: 180 },
  }

  const areas: Area[] = [
    { id: AREA.focus, name: 'Focus' },
    { id: AREA.social, name: 'Social' },
    { id: AREA.gym, name: 'Gym' },
  ]

  // [weekday, area, start, end, protected]
  const templateRows: [Weekday, string, string, string, boolean][] = [
    [1, AREA.focus, '08:00', '12:00', false],
    [1, AREA.focus, '13:30', '16:30', false],
    [1, AREA.gym, '17:30', '19:00', false],
    [1, AREA.focus, '20:00', '22:00', false],
    [2, AREA.focus, '08:00', '12:00', false],
    [2, AREA.focus, '13:30', '16:30', false],
    [2, AREA.gym, '17:30', '19:00', false],
    [2, AREA.focus, '20:00', '22:00', false],
    [3, AREA.focus, '08:00', '12:00', false],
    [3, AREA.focus, '13:30', '16:30', false],
    [3, AREA.gym, '17:30', '19:00', false],
    [3, AREA.focus, '20:00', '22:00', false],
    [4, AREA.focus, '08:00', '12:00', false],
    [4, AREA.focus, '13:30', '16:30', false],
    [4, AREA.focus, '20:00', '22:00', false],
    [5, AREA.focus, '08:00', '12:00', false],
    [5, AREA.focus, '13:30', '16:30', false],
    [5, AREA.gym, '17:30', '19:00', false],
    [5, AREA.social, '19:00', '23:00', true],
    [6, AREA.focus, '09:00', '12:00', false],
    [6, AREA.gym, '13:00', '14:30', false],
    [0, AREA.focus, '09:00', '12:00', false],
  ]
  const perDay: Record<number, number> = {}
  const blockTemplates: BlockTemplate[] = templateRows.map(([weekday, areaId, start, end, prot]) => {
    perDay[weekday] = (perDay[weekday] ?? 0) + 1
    return { id: `tpl-${weekday}-${perDay[weekday]}`, weekday, areaId, start, end, protected: prot }
  })

  // Core goals (M7): job acquisition, course progress, coding this app, gym; plus Housekeeping.
  // goal-course and goal-code are placeholders until the owner sets real ones.
  const goals: Goal[] = [
    {
      id: 'goal-job',
      title: 'Secure a job',
      type: 'open_path',
      areaId: AREA.focus,
      target: 20,
      period: 'week',
      deadline: '2026-12-31',
      detailFields: ['role', 'company'],
    },
    {
      id: 'goal-course',
      title: 'CFA Level 1',
      type: 'recurring',
      areaId: AREA.focus,
      target: 5,
      period: 'week',
      deadline: '2027-02-28',
    },
    { id: 'goal-code', title: 'Build Jeeves and Trellis', type: 'open_path', areaId: AREA.focus, deadline: '2026-12-31' },
    {
      // Runs as the Gym blocks (5 a week), not as tasks: each ticked Gym block counts once.
      id: 'goal-lifting',
      title: 'Olympic lifting: C&J 120kg, snatch 100kg',
      type: 'recurring',
      areaId: AREA.gym,
      target: 5,
      period: 'week',
      deadline: '2026-12-31',
      servedByBlocks: true,
      detailFields: ['lift', 'weight'],
    },
    { id: HOUSEKEEPING_ID, title: 'Housekeeping', type: 'open_path', areaId: AREA.focus, isHousekeeping: true },
  ]

  const projects: Project[] = [
    { id: 'proj-job-setup', title: 'Job search setup', goalId: 'goal-job' },
    { id: 'proj-cfa-units', title: 'CFA L1 units', goalId: 'goal-course' },
    { id: 'proj-jeeves', title: 'Jeeves Iteration 2', goalId: 'goal-code' },
    { id: 'proj-trellis', title: 'Launch Trellis', goalId: 'goal-code' },
    { id: 'proj-motorbike', title: 'Sell motorbike', goalId: HOUSEKEEPING_ID },
  ]
  const goalOf = new Map(projects.map((p) => [p.id, p.goalId]))

  // [title, estimate, goal or project, extras]. A project task takes its project's goal.
  type Row = [string, number, string, Partial<Task>?]
  const step = (projectId: string) => (title: string, estimate: number, order: number): Row => [
    title,
    estimate,
    projectId,
    { order },
  ]
  const jeeves = step('proj-jeeves')
  const cfa = step('proj-cfa-units')
  const job = step('proj-job-setup')
  const bike = step('proj-motorbike')
  const rows: Row[] = [
    // Coding: Jeeves Iteration 2, then Trellis
    jeeves('M7 Hierarchy', 240, 1),
    jeeves('M8 Capture', 180, 2),
    jeeves('M9 Project workflow + AI', 240, 3),
    jeeves('M10 Editable blocks', 240, 4),
    jeeves('M11 Contribution view', 180, 5),
    jeeves('Two-week self-test', 60, 6),
    ['Scope Trellis MVP', 120, 'proj-trellis', { order: 1 }],
    // Course: one unit at a time
    cfa('Ethics and professional standards', 90, 1),
    cfa('Quantitative methods', 90, 2),
    cfa('Economics', 90, 3),
    cfa('Financial statement analysis', 90, 4),
    // Job: applications (open path), then the setup project
    ...Array.from({ length: 5 }, (_, i): Row => [`Application #${i + 1}`, 40, 'goal-job']),
    job('Update CV', 120, 1),
    job('Refresh LinkedIn', 60, 2),
    job('Build target list of firms', 120, 3),
    job('Set up application tracker', 30, 4),
    job('Recruiter outreach – first 10', 60, 5),
    // Housekeeping: its own tasks (any area), then the motorbike sale
    ['Do laundry', 45, HOUSEKEEPING_ID, { due: due(1), repeat: { kind: 'every', days: 8 } }],
    ['Plan meals for the week', 30, HOUSEKEEPING_ID, { due: due(nextSunday), repeat: { kind: 'weekly', weekday: 0 } }],
    ['Weekly food shop', 60, HOUSEKEEPING_ID],
    ['Clean flat', 60, HOUSEKEEPING_ID],
    ['Admin/post', 30, HOUSEKEEPING_ID],
    bike('Clean and photograph the bike', 60, 1),
    bike('Check prices and set an asking price', 30, 2),
    bike('List it online', 30, 3),
    bike('Arrange viewings and sell', 60, 4),
  ]

  const tasks: Task[] = rows.map(([title, estimate, home, extra], i) => ({
    id: `task-${String(i + 1).padStart(2, '0')}`,
    title,
    estimate,
    areaId: AREA.focus,
    goalId: goalOf.get(home) ?? home,
    ...(goalOf.has(home) && { projectId: home }),
    status: 'backlog',
    rollovers: 0,
    delegable: false,
    createdAt: created(rows.length - i), // oldest first, one per day
    ...extra,
  }))

  return { settings, areas, blockTemplates, goals, projects, tasks }
}
