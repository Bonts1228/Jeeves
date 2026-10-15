import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  Area,
  Block,
  BlockTemplate,
  Goal,
  InboxItem,
  LogEntry,
  Project,
  Settings,
  Task,
} from '../types'
import { goalToV2 } from './migrations'

// Settings is a single row stored under this out-of-line key.
export const SETTINGS_KEY = 'settings'
export const LAST_EXPORT_KEY = 'lastExportAt'

export class BriefDB extends Dexie {
  settings!: Table<Settings, string>
  areas!: EntityTable<Area, 'id'>
  blockTemplates!: EntityTable<BlockTemplate, 'id'>
  blocks!: EntityTable<Block, 'id'>
  goals!: EntityTable<Goal, 'id'>
  projects!: EntityTable<Project, 'id'>
  tasks!: EntityTable<Task, 'id'>
  logEntries!: EntityTable<LogEntry, 'id'>
  inbox!: EntityTable<InboxItem, 'id'>
  meta!: Table<string, string> // about this device, never exported: 'lastExportAt'

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
  }
}

export const db = new BriefDB()

export const newId = () => crypto.randomUUID()
