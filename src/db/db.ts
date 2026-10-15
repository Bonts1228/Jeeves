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

// Settings is a single row stored under this out-of-line key.
export const SETTINGS_KEY = 'settings'

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
  }
}

export const db = new BriefDB()

export const newId = () => crypto.randomUUID()
