import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Placement } from '../db/blocks'
import { type Area, type Goal, HOUSEKEEPING_ID, type ID, type ISODate, type Project, type Repeat, type Task } from '../types'
import { addDays, parseISODate } from './dates'
import { formatDuration, WEEKDAY_SHORT } from './time'

// Draft state and helpers behind the task chips (components/TaskFields).

export const DEFAULT_ESTIMATE = 30

// Where a task goes. null = not chosen: Housekeeping.
export type Link = { goalId: ID } | { projectId: ID } | null

export interface ScheduleDraft {
  date: ISODate
  placement: Placement | null // null: a block still has to be picked
}

// null = not chosen, so a default applies
export interface Fields {
  estimate: number | null
  areaId: ID | null
  link: Link
  due?: ISODate
  repeat?: Repeat
  schedule: ScheduleDraft | null
}

export const emptyFields = (link: Link = null): Fields => ({ estimate: null, areaId: null, link, schedule: null })

export interface Refs {
  areas: Area[]
  goals: Goal[]
  projects: Project[]
}

export function useRefs(): Refs | undefined {
  const areas = useLiveQuery(() => db.areas.toArray())
  const goals = useLiveQuery(() => db.goals.toArray())
  const projects = useLiveQuery(() => db.projects.toArray())
  return areas && goals && projects ? { areas, goals, projects } : undefined
}

// Fields with defaults applied: estimate 30m; goal from the project, else the linked goal, else
// Housekeeping; area from the goal, else the first area.
export function resolve(fields: Fields, refs: Refs) {
  const { link } = fields
  const project = link && 'projectId' in link ? refs.projects.find((p) => p.id === link.projectId) : undefined
  const goalId = project?.goalId ?? (link && 'goalId' in link ? link.goalId : HOUSEKEEPING_ID)
  const goal = refs.goals.find((g) => g.id === goalId)
  return {
    project,
    goal,
    estimate: fields.estimate ?? DEFAULT_ESTIMATE,
    areaId: fields.areaId ?? goal?.areaId ?? refs.areas[0]?.id,
  }
}

export function dayLabel(date: ISODate, today: ISODate) {
  if (date === today) return 'today'
  if (date === addDays(today, 1)) return 'tomorrow'
  return parseISODate(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function repeatLabel(r: Repeat) {
  return r.kind === 'every' ? `Every ${r.days} day${r.days === 1 ? '' : 's'}` : `Every ${WEEKDAY_SHORT[r.weekday]}`
}

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// One line under a task: estimate (or Done), when it's scheduled, due, repeat.
export function taskFacts(t: Task, today: string) {
  return [
    t.status === 'done' ? 'Done' : formatDuration(t.estimate),
    t.status === 'scheduled' && t.date && `Scheduled ${dayLabel(t.date, today)}`,
    t.due && t.status !== 'done' && `Due ${dayLabel(t.due, today)}`,
    t.repeat && repeatLabel(t.repeat),
  ]
    .filter(Boolean)
    .join(' · ')
}
