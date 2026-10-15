// Mirrors the schema in CLAUDE.md. Overdue and progress are computed, never stored.

export type ID = string // uuid
export type ISODate = string // '2026-10-15'
export type Minutes = number
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6 // 0 = Sunday

export interface Settings {
  briefTime: string // '20:00'
  capacity: Record<Weekday, Minutes>
}

export interface Area {
  id: ID
  name: string
}

export interface BlockTemplate {
  id: ID
  areaId: ID
  weekday: Weekday
  start: string // '09:00'
  end: string // '11:00'
  protected: boolean // true = no tasks placed (e.g. Family)
}

// Generated per date from templates; editable per day
export interface Block {
  id: ID
  templateId?: ID
  areaId: ID
  date: ISODate
  start: string
  end: string
  protected: boolean
}

export type GoalType = 'set_path' | 'open_path' | 'recurring'

export interface Goal {
  id: ID
  title: string
  type: GoalType
  areaId: ID
  target?: number
  period?: 'week' | 'month'
  deadline?: ISODate
  recurringBlockId?: ID // recurring goals run as a count OR a reserved block
  detailFields?: string[] // e.g. ['role', 'company']
}

export interface Project {
  id: ID
  title: string
  areaId: ID
}

export type TaskStatus = 'backlog' | 'scheduled' | 'done' | 'deleted'

export interface Task {
  id: ID
  title: string
  estimate: Minutes
  areaId: ID
  goalId?: ID
  projectId?: ID
  order?: number // step position in a set path or project
  due?: ISODate
  status: TaskStatus
  date?: ISODate // set when scheduled
  blockId?: ID
  reason?: string // one-line reason shown in the brief
  rollovers: number // times moved on unfinished: calibration signal
  delegable: boolean
  createdAt: string
}

export interface LogEntry {
  id: ID
  taskId: ID
  goalId?: ID
  completedAt: string
  details?: Record<string, string>
}

export interface InboxItem {
  id: ID
  text: string
  createdAt: string
}
