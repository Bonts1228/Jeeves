// Row migrations, shared by the Dexie upgrades (db.ts) and by importing an older export file
// (backup.ts), so an old phone database and an old file take the same path.

import { HOUSEKEEPING_ID } from '../types'

// The Dexie schema version. Exports carry it; bump it with every db.version().
export const SCHEMA_VERSION = 5

type Row = Record<string, unknown>

// v2: recurringBlockId replaced by servedByBlocks (set by hand: the old single block can't say which area)
export function goalToV2(goal: Row) {
  delete goal.recurringBlockId
}

// The Housekeeping project the seed made before v5; it becomes the Housekeeping goal itself.
const OLD_HOUSEKEEPING = 'proj-housekeeping'
const isOldHousekeeping = (p: Row) =>
  p.id === OLD_HOUSEKEEPING || (p.manualOnly === true && !p.goalId && p.title === 'Housekeeping')
const INBOX_ESTIMATE = 30 // the capture default (lib/task-fields DEFAULT_ESTIMATE)

// v5 (M7): Goal → Project → Task. Every task has a goalId (Housekeeping if nothing else), a
// project task's goalId is its project's, projects belong to a goal and lose areaId, set-path goals
// become a goal plus a project holding their steps, and Inbox items become Housekeeping tasks.
// Log entries aren't touched: history stays on the same goal ids. inbox: the old table's rows.
export function toV5(tables: { areas: Row[]; goals: Row[]; projects: Row[]; tasks: Row[] }, inbox: Row[] = []) {
  const { areas, goals, projects, tasks } = tables

  // 1. The Housekeeping goal, in the old Housekeeping project's area
  const oldHouse = projects.filter(isOldHousekeeping)
  let house = goals.find((g) => g.id === HOUSEKEEPING_ID)
  if (!house) {
    house = { id: HOUSEKEEPING_ID, title: 'Housekeeping', type: 'open_path', areaId: oldHouse[0]?.areaId ?? areas[0]?.id ?? '' }
    goals.push(house)
  }
  house.isHousekeeping = true
  delete house.target
  delete house.period
  const houseId = house.id as string

  // 2. Old Housekeeping projects dissolve: their tasks sit straight under the goal, unordered
  const dissolved = new Set(oldHouse.map((p) => p.id))
  for (const t of tasks)
    if (dissolved.has(t.projectId)) {
      t.goalId = houseId
      delete t.projectId
      delete t.order
    }
  for (const p of projects) if (dissolved.has(p.startsAfterProjectId)) delete p.startsAfterProjectId
  tables.projects = projects.filter((p) => !dissolved.has(p.id))

  // 3. Set-path goals keep their id (and log history) as open paths; their steps move to a project
  for (const g of goals) {
    if (g.type !== 'set_path') continue
    g.type = 'open_path'
    delete g.target
    delete g.period
    const projectId = `proj-from-${g.id}`
    tables.projects.push({ id: projectId, title: g.title, goalId: g.id })
    for (const t of tasks) if (t.goalId === g.id && !t.projectId) t.projectId = projectId
  }

  // 4. Projects belong to a goal that exists, else Housekeeping; area comes from the goal
  const goalIds = new Set(goals.map((g) => g.id))
  for (const p of tables.projects) {
    if (!goalIds.has(p.goalId)) p.goalId = houseId
    delete p.areaId
  }

  // 5. Every task gets a home. A goal-direct task is never ordered.
  const projectGoal = new Map(tables.projects.map((p) => [p.id, p.goalId]))
  for (const t of tasks) {
    if (t.projectId && !projectGoal.has(t.projectId)) delete t.projectId
    if (t.projectId) t.goalId = projectGoal.get(t.projectId)
    else {
      if (!goalIds.has(t.goalId)) t.goalId = houseId
      delete t.order
    }
  }

  // 6. Inbox items become Housekeeping tasks with the capture defaults
  for (const item of inbox)
    tasks.push({
      id: item.id,
      title: item.text,
      estimate: INBOX_ESTIMATE,
      areaId: house.areaId,
      goalId: houseId,
      status: 'backlog',
      rollovers: 0,
      delegable: false,
      createdAt: item.createdAt,
    })
}

// Upgrade exported tables in place from fromVersion to SCHEMA_VERSION. An old file's inbox rows
// are consumed and its inbox table removed.
// v3 only added the meta table, which exports don't carry; v4 only added optional project fields.
export function migrateTables(tables: Record<string, Row[]>, fromVersion: number) {
  if (fromVersion < 2) tables.goals.forEach(goalToV2)
  if (fromVersion < 5) {
    const t = tables as { areas: Row[]; goals: Row[]; projects: Row[]; tasks: Row[] }
    toV5(t, tables.inbox ?? [])
    tables.projects = t.projects
    delete tables.inbox
  }
}
