// The owner's real week.
// IDs are stable strings so re-running the seed always produces the same rows.
// Created/due dates are relative to the day the seed runs; goal deadlines are fixed.

import type { Area, BlockTemplate, Goal, Project, Settings, Task, Weekday } from '../types'

export interface SeedData {
  settings: Settings
  areas: Area[]
  blockTemplates: BlockTemplate[]
  goals: Goal[]
  projects: Project[]
  tasks: Task[]
}

const AREA = { focus: 'area-focus', social: 'area-social', gym: 'area-gym' }

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

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

  const goals: Goal[] = [
    { id: 'goal-jeeves', title: 'Launch Jeeves', type: 'set_path', areaId: AREA.focus, deadline: '2026-11-30' },
    { id: 'goal-trellis', title: 'Launch Trellis', type: 'set_path', areaId: AREA.focus, deadline: '2026-12-31' },
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
      // Runs as the reserved Gym blocks (5 a week), not as tasks. recurringBlockId holds a
      // single ID, so it can't point at all five templates yet; the Gym area marks them.
      id: 'goal-lifting',
      title: 'Olympic lifting: C&J 120kg, snatch 100kg',
      type: 'recurring',
      areaId: AREA.gym,
      target: 5,
      period: 'week',
      deadline: '2026-12-31',
      detailFields: ['lift', 'weight'],
    },
  ]

  const projects: Project[] = [{ id: 'proj-housekeeping', title: 'Housekeeping', areaId: AREA.focus }]

  // [title, estimate, area, extras]
  type Row = [string, number, string, Partial<Task>?]
  const jeeves = (title: string, hours: number, order: number): Row => [
    title,
    hours * 60,
    AREA.focus,
    { goalId: 'goal-jeeves', order },
  ]
  const rows: Row[] = [
    // Set path: Launch Jeeves, ordered milestones
    jeeves('M2 Backlog + capture (1/2)', 3, 1),
    jeeves('M2 Backlog + capture (2/2)', 3, 2),
    jeeves('M3 Brief (1/2)', 3, 3),
    jeeves('M3 Brief (2/2)', 3, 4),
    jeeves('M4 Day + focus block (1/2)', 3, 5),
    jeeves('M4 Day + focus block (2/2)', 3, 6),
    jeeves('M5 Unfinished + overdue', 4, 7),
    jeeves('M6 Progress + re-plan', 4, 8),
    jeeves('Two-week self-test', 1, 9),
    jeeves('Launch', 3, 10),
    // Set path: Launch Trellis
    ['Scope Trellis MVP', 120, AREA.focus, { goalId: 'goal-trellis', order: 1 }],
    // Open path: job applications
    ...Array.from({ length: 20 }, (_, i): Row => [`Application #${i + 1}`, 40, AREA.focus, { goalId: 'goal-job' }]),
    // Project: Housekeeping
    ['Do laundry', 45, AREA.focus, { projectId: 'proj-housekeeping' }],
    ['Plan meals for the week', 30, AREA.focus, { projectId: 'proj-housekeeping', due: due(nextSunday) }],
    ['Weekly food shop', 60, AREA.focus, { projectId: 'proj-housekeeping' }],
    ['Clean flat', 60, AREA.focus, { projectId: 'proj-housekeeping' }],
    ['Admin/post', 30, AREA.focus, { projectId: 'proj-housekeeping' }],
  ]

  const tasks: Task[] = rows.map(([title, estimate, areaId, extra], i) => ({
    id: `task-${String(i + 1).padStart(2, '0')}`,
    title,
    estimate,
    areaId,
    status: 'backlog',
    rollovers: 0,
    delegable: false,
    createdAt: created(rows.length - i), // oldest first, one per day
    ...extra,
  }))

  return { settings, areas, blockTemplates, goals, projects, tasks }
}
