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
  servedByBlocks?: boolean // recurring only: every block in areaId counts as one; else a count of ticked tasks
  detailFields?: string[] // e.g. ['role', 'company']
}

export interface Project {
  id: ID
  title: string
  areaId: ID
  goalId?: ID // done steps log against this goal
  manualOnly?: boolean // e.g. Housekeeping: never auto-placed unless due or overdue
  notBefore?: ISODate // held back until this date
  startsAfterProjectId?: ID // held back until that project's steps are all done or deleted; then cleared
}

export type Repeat =
  | { kind: 'every'; days: number } // laundry: every 8 days from when last done
  | { kind: 'weekly'; weekday: Weekday } // meal plan: every Sunday

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
  repeat?: Repeat // requires due; done creates the next occurrence
  prevId?: ID // the occurrence this one follows; at most one task per prevId
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
  goalId?: ID
  taskId?: ID // a ticked task, or
  blockId?: ID // a ticked block of a servedByBlocks goal
  completedAt: string
  details?: Record<string, string>
}

export interface InboxItem {
  id: ID
  text: string
  createdAt: string
}
