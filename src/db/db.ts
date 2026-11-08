import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  Area,
  Block,
  BlockTemplate,
  Goal,
  LogEntry,
  Project,
  Settings,
  Task,
} from '../types'
import { goalToV2, toV5 } from './migrations'

// Settings is a single row stored under this out-of-line key.
export const SETTINGS_KEY = 'settings'
export const LAST_EXPORT_KEY = 'lastExportAt'
export const SEED_KEY = 'seedVersion' // the seed the data started from (db/seed.ts)

export class BriefDB extends Dexie {
  settings!: Table<Settings, string>
  areas!: EntityTable<Area, 'id'>
  blockTemplates!: EntityTable<BlockTemplate, 'id'>
  blocks!: EntityTable<Block, 'id'>
  goals!: EntityTable<Goal, 'id'>
  projects!: EntityTable<Project, 'id'>
  tasks!: EntityTable<Task, 'id'>
  logEntries!: EntityTable<LogEntry, 'id'>
  meta!: Table<string, string> // about this device, never exported: 'lastExportAt', 'seedVersion'

  constructor(name = 'daily-brief') {
    super(name)
    this.version(1).stores({
      settings: '',
      areas: 'id',
      blockTemplates: 'id, weekday, areaId',
      blocks: 'id, date, templateId',
      goals: 'id, areaId',
      projects: 'id, areaId',
      tasks: 'id, status, date, areaId, goalId, projectId, blockId',
      logEntries: 'id, taskId, goalId, completedAt',
      inbox: 'id',
    })
    // M2: repeat chains by prevId; block goals log a blockId; recurringBlockId replaced by servedByBlocks
    this.version(2)
      .stores({
        tasks: 'id, status, date, areaId, goalId, projectId, blockId, prevId',
        logEntries: 'id, taskId, blockId, goalId, completedAt',
      })
      .upgrade((tx) => tx.table('goals').toCollection().modify(goalToV2))
    // v3: device facts like the last export time, kept out of the data tables and exports
    this.version(3).stores({ meta: '' })
    // v4: project hold-back. New fields are optional, so rows need no upgrade; the index finds the
    // projects waiting on one.
    this.version(4).stores({ projects: 'id, areaId, startsAfterProjectId' })
    // v5 (M7): Goal → Project → Task with a Housekeeping goal; the Inbox becomes Housekeeping tasks.
    // The inbox table is dropped after this upgrade runs, so its rows can still be read here.
    this.version(5)
      .stores({ projects: 'id, goalId, startsAfterProjectId', inbox: null })
      .upgrade(async (tx) => {
        const read = (name: string) => tx.table(name).toArray()
        const tables = { areas: await read('areas'), goals: await read('goals'), projects: await read('projects'), tasks: await read('tasks') }
        toV5(tables, await read('inbox'))
        for (const name of ['goals', 'projects', 'tasks'] as const) {
          await tx.table(name).clear()
          await tx.table(name).bulkAdd(tables[name])
        }
      })
  }
}

export const db = new BriefDB()

export const newId = () => crypto.randomUUID()
