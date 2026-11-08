import { findWaitLoop } from '../lib/holdback'
import { HOUSEKEEPING_ID, type Settings } from '../types'
import { type BriefDB, db as defaultDb, LAST_EXPORT_KEY, SETTINGS_KEY } from './db'
import { BLOCKS_MADE_PREFIX } from './blocks'
import { migrateTables, SCHEMA_VERSION } from './migrations'

// Export / import of everything on the device as one JSON file. The meta table (device facts like
// the last export time) is never exported. Import checks the whole file before touching anything,
// upgrades older files, and replaces all data in one transaction.

const APP = 'daily-brief'

export const DATA_TABLES = [
  'areas',
  'blockTemplates',
  'blocks',
  'goals',
  'projects',
  'tasks',
  'logEntries',
] as const
type DataTable = (typeof DATA_TABLES)[number]
// Tables only older files carry: read and migrated away on import (v5 turned the Inbox into tasks).
const OLD_TABLES = { inbox: 5 } as const
type FileTable = DataTable | keyof typeof OLD_TABLES
type Row = Record<string, unknown>

export interface ExportFile {
  app: typeof APP
  schemaVersion: number
  exportedAt: string
  settings: Settings
  tables: Record<DataTable, Row[]>
}

export async function exportData(db: BriefDB = defaultDb, now = new Date()): Promise<ExportFile> {
  return db.transaction('r', [db.settings, ...DATA_TABLES.map((t) => db.table(t))], async () => {
    const settings = await db.settings.get(SETTINGS_KEY)
    if (!settings) throw new Error('Nothing to export: no settings on this device.')
    const tables = {} as Record<DataTable, Row[]>
    for (const name of DATA_TABLES) tables[name] = await db.table(name).toArray()
    return { app: APP, schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), settings, tables }
  })
}

export const exportFileName = (now = new Date()) =>
  `daily-brief-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`

export async function markExported(at: string, db: BriefDB = defaultDb) {
  await db.meta.put(at, LAST_EXPORT_KEY)
}

export async function lastExport(db: BriefDB = defaultDb): Promise<string | undefined> {
  return db.meta.get(LAST_EXPORT_KEY)
}

// What a row of each table must have. Optional fields aren't checked.
type Check = 'string' | 'number' | 'boolean' | 'weekday' | readonly string[]
// Checked before migrating, so they're what every version shares; goal links are checked after (checkHomes).
const REQUIRED: Record<FileTable, { label: string; fields: Record<string, Check> }> = {
  areas: { label: 'Area', fields: { id: 'string', name: 'string' } },
  blockTemplates: {
    label: 'Block template',
    fields: { id: 'string', areaId: 'string', weekday: 'weekday', start: 'string', end: 'string', protected: 'boolean' },
  },
  blocks: {
    label: 'Block',
    fields: { id: 'string', areaId: 'string', date: 'string', start: 'string', end: 'string', protected: 'boolean' },
  },
  goals: {
    label: 'Goal',
    fields: { id: 'string', title: 'string', areaId: 'string', type: ['set_path', 'open_path', 'recurring'] },
  },
  projects: { label: 'Project', fields: { id: 'string', title: 'string' } },
  tasks: {
    label: 'Task',
    fields: {
      id: 'string',
      title: 'string',
      estimate: 'number',
      areaId: 'string',
      status: ['backlog', 'scheduled', 'done', 'deleted'],
      rollovers: 'number',
      delegable: 'boolean',
      createdAt: 'string',
    },
  },
  logEntries: { label: 'Log entry', fields: { id: 'string', completedAt: 'string' } },
  inbox: { label: 'Inbox item', fields: { id: 'string', text: 'string', createdAt: 'string' } },
}

// v5: every task and project belongs to a goal in the file, and the Housekeeping goal is there.
function checkHomes(tables: Record<DataTable, Row[]>): string | null {
  const goals = new Set(tables.goals.map((g) => g.id))
  if (tables.goals.some((g) => g.type === 'set_path')) return 'A goal still has the old set-path type.'
  if (!tables.goals.some((g) => g.id === HOUSEKEEPING_ID && g.isHousekeeping === true)) return 'The file has no Housekeeping goal.'
  const project = tables.projects.find((p) => !goals.has(p.goalId))
  if (project) return `Project “${project.title}” belongs to a goal that isn't in the file.`
  const projectGoal = new Map(tables.projects.map((p) => [p.id, p.goalId]))
  const task = tables.tasks.find(
    (t) => !goals.has(t.goalId) || (t.projectId !== undefined && projectGoal.get(t.projectId) !== t.goalId),
  )
  if (task) return `Task “${task.title}” belongs to a goal or project that isn't in the file.`
  return null
}

function fits(value: unknown, check: Check) {
  if (Array.isArray(check)) return check.includes(value as string)
  if (check === 'weekday') return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6
  return typeof value === check
}

// Project hold-back (v4): a real date, a project in the file, and no loop of waits (A → B → A).
function checkHoldBack(projects: Row[]): string | null {
  const ids = new Set(projects.map((p) => p.id))
  const name = (id: unknown) => `“${projects.find((p) => p.id === id)?.title}”`
  for (const p of projects) {
    if (p.notBefore !== undefined && !(typeof p.notBefore === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.notBefore)))
      return `Project ${name(p.id)} has an invalid notBefore.`
    if (p.startsAfterProjectId !== undefined && !ids.has(p.startsAfterProjectId))
      return `Project ${name(p.id)} waits on a project that isn't in the file.`
  }
  const loop = findWaitLoop(projects as { id: string; startsAfterProjectId?: string }[])
  if (!loop) return null
  if (loop.length === 1) return `Project ${name(loop[0])} waits on itself.`
  return `Projects wait on each other in a loop: ${[...loop, loop[0]].map(name).join(' → ')}.`
}

const isObject = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v)

// Log entry details (M6): if present, field names to text, as the details form writes them.
function checkDetails(entries: Row[]): string | null {
  const bad = entries.findIndex(
    (e) => e.details !== undefined && !(isObject(e.details) && Object.values(e.details).every((v) => typeof v === 'string')),
  )
  return bad < 0 ? null : `Log entry ${bad + 1} has invalid details.`
}

export interface ImportSummary {
  exportedAt: string
  fromVersion: number
  tasks: number // not deleted
  goals: number
  projects: number
}

export type ParsedImport = { ok: true; file: ExportFile; summary: ImportSummary } | { ok: false; reason: string }

// Check a file completely and upgrade it to the current schema. Touches no data.
export function parseImport(text: string): ParsedImport {
  const fail = (reason: string): ParsedImport => ({ ok: false, reason })
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail("This isn't a valid JSON file.")
  }
  if (!isObject(raw) || raw.app !== APP) return fail("This isn't a Daily Brief export.")

  const version = raw.schemaVersion
  if (!Number.isInteger(version) || (version as number) < 1) return fail('The file has no valid schema version.')
  if ((version as number) > SCHEMA_VERSION)
    return fail(`Made by a newer version of the app (schema ${version}, this app has ${SCHEMA_VERSION}). Update the app first.`)
  if (typeof raw.exportedAt !== 'string' || Number.isNaN(Date.parse(raw.exportedAt)))
    return fail('The file has no valid export time.')

  const settings = raw.settings
  if (
    !isObject(settings) ||
    typeof settings.briefTime !== 'string' ||
    !isObject(settings.capacity) ||
    [0, 1, 2, 3, 4, 5, 6].some((d) => typeof (settings.capacity as Row)[d] !== 'number')
  )
    return fail('Settings are missing or incomplete.')

  if (!isObject(raw.tables)) return fail('The file has no tables.')
  const tables = {} as Record<FileTable, Row[]>
  const old = Object.entries(OLD_TABLES).flatMap(([name, gone]) => ((version as number) < gone ? [name as FileTable] : []))
  for (const name of [...DATA_TABLES, ...old]) {
    const rows = raw.tables[name] ?? (name in OLD_TABLES ? [] : undefined) // an old table may be absent: nothing to migrate
    if (!Array.isArray(rows)) return fail(`The ${name} table is missing.`)
    const { label, fields } = REQUIRED[name]
    const seen = new Set<unknown>()
    for (const [i, row] of rows.entries()) {
      if (!isObject(row)) return fail(`${label} ${i + 1} isn't a record.`)
      for (const [field, check] of Object.entries(fields))
        if (!fits(row[field], check))
          return fail(`${label} ${i + 1}${typeof row.title === 'string' ? ` (“${row.title}”)` : ''} has a missing or invalid ${field}.`)
      if (seen.has(row.id)) return fail(`Two ${label.toLowerCase()} rows share the id ${row.id}.`)
      seen.add(row.id)
    }
    tables[name] = structuredClone(rows)
  }

  const problem = checkHoldBack(tables.projects) ?? checkDetails(tables.logEntries)
  if (problem) return fail(problem)

  migrateTables(tables, version as number)
  const homes = checkHomes(tables)
  if (homes) return fail(homes)
  const file: ExportFile = {
    app: APP,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: raw.exportedAt,
    settings: settings as unknown as Settings,
    tables,
  }
  return {
    ok: true,
    file,
    summary: {
      exportedAt: raw.exportedAt,
      fromVersion: version as number,
      tasks: tables.tasks.filter((t) => t.status !== 'deleted').length,
      goals: tables.goals.length,
      projects: tables.projects.length,
    },
  }
}

// Replace everything on the device with a parsed file, in one transaction: if any write fails,
// nothing changes. The last export time becomes the file's: the data on the device is backed up as of then.
export async function importData(file: ExportFile, db: BriefDB = defaultDb) {
  await db.transaction('rw', [db.settings, db.meta, ...DATA_TABLES.map((t) => db.table(t))], async () => {
    await db.settings.clear()
    await db.settings.put(file.settings, SETTINGS_KEY)
    for (const name of DATA_TABLES) {
      await db.table(name).clear()
      await db.table(name).bulkAdd(file.tables[name])
    }
    // The device's made-day flags describe the blocks just replaced
    await db.meta.where(':id').startsWith(BLOCKS_MADE_PREFIX).delete()
    await markExported(file.exportedAt, db)
  })
}
