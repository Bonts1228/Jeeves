import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { GoalSheet } from '../components/GoalSheet'
import { ProjectSheet } from '../components/ProjectSheet'
import { TaskSheet } from '../components/TaskSheet'
import { secondaryBtn } from '../components/ui'
import { db } from '../db/db'
import { dayMonth, isoDate } from '../lib/dates'
import { heldBackLabel, isHeldBack } from '../lib/holdback'
import { goalNumber, lastDetails, nextStep, paceLabel, projectNumber } from '../lib/progress'
import { taskFacts } from '../lib/task-fields'
import { useNow } from '../lib/use-now'
import type { Goal, GoalType, Task } from '../types'

const GOAL_TYPE: Record<GoalType, string> = {
  set_path: 'Set path',
  open_path: 'Open path',
  recurring: 'Recurring',
}

// Inbox count, goals and projects as numbers, then loose tasks, then held-back projects (Later). Goals and projects open their own
// screens; loose tasks open for editing here.
export function Backlog() {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState<'goal' | 'project' | null>(null)
  const now = useNow() // the period rolls over at midnight
  const inboxCount = useLiveQuery(() => db.inbox.count())
  const areas = useLiveQuery(() => db.areas.toArray())
  const goals = useLiveQuery(() => db.goals.toArray())
  const projects = useLiveQuery(() => db.projects.toArray())
  const tasks = useLiveQuery(() => db.tasks.where('status').anyOf('backlog', 'scheduled', 'done').toArray())
  const logs = useLiveQuery(() => db.logEntries.toArray())

  if (inboxCount === undefined || !areas || !goals || !projects || !tasks || !logs) return null

  const today = isoDate(now)
  const isOpen = (t: Task) => t.status !== 'done'
  const loose = tasks.filter((t) => isOpen(t) && !t.goalId && !t.projectId)
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? 'area'
  const later = projects.filter((p) => isHeldBack(p, today))

  const goalSub = (g: Goal) => {
    const own = tasks.filter((t) => t.goalId === g.id && !t.projectId)
    const detail =
      g.type === 'set_path'
        ? nextStep(own) && `Next: ${nextStep(own)!.title}`
        : g.servedByBlocks
          ? `Every ${areaName(g.areaId)} block`
          : `${own.filter(isOpen).length} open`
    return [GOAL_TYPE[g.type], detail].filter(Boolean).join(' · ')
  }
  // Under the goal: its numbers (pace against target, time left, deadline), then the latest details
  const goalNotes = (g: Goal) => {
    const numbers = [paceLabel(g, logs, now), g.deadline && `By ${dayMonth(g.deadline)}`].filter(Boolean).join(' · ')
    const last = lastDetails(g, logs)
    return [numbers, last && `Last: ${last}`].filter(Boolean)
  }

  return (
    <div className="space-y-6">
      <Link to="/inbox" className="flex min-h-14 items-center justify-between rounded-xl bg-white px-4 active:bg-stone-50">
        <span className="font-medium">Inbox</span>
        <span className="tabular-nums text-stone-500">{inboxCount}</span>
      </Link>

      <Group title="Goals">
        {goals.map((g) => (
          <Row
            key={g.id}
            title={g.title}
            sub={goalSub(g)}
            notes={goalNotes(g)}
            value={goalNumber(g, tasks, logs, now)}
            to={`/goals/${g.id}`}
          />
        ))}
      </Group>

      <Group title="Projects">
        {projects.filter((p) => !isHeldBack(p, today)).map((p) => {
          const next = nextStep(tasks.filter((t) => t.projectId === p.id))
          return (
            <Row
              key={p.id}
              title={p.title}
              sub={p.manualOnly ? 'Only when you add it' : next && `Next: ${next.title}`}
              value={projectNumber(p, tasks)}
              to={`/projects/${p.id}`}
            />
          )
        })}
      </Group>

      <div className="flex gap-2">
        <button type="button" className={`${secondaryBtn} flex-1`} onClick={() => setCreating('goal')}>
          + Goal
        </button>
        <button type="button" className={`${secondaryBtn} flex-1`} onClick={() => setCreating('project')}>
          + Project
        </button>
      </div>

      {loose.length > 0 && (
        <Group title={`Tasks · ${loose.length}`}>
          {loose.map((t) => (
            <Row key={t.id} title={t.title} sub={taskFacts(t, today)} onClick={() => setEditing(t.id)} />
          ))}
        </Group>
      )}
      {later.length > 0 && (
        <Group title="Later">
          {later.map((p) => (
            <Row
              key={p.id}
              title={p.title}
              sub={heldBackLabel(p, projects, tasks)}
              value={projectNumber(p, tasks)}
              to={`/projects/${p.id}`}
            />
          ))}
        </Group>
      )}
      {editing && <TaskSheet taskId={editing} onClose={() => setEditing(null)} />}
      {creating === 'goal' && <GoalSheet onClose={() => setCreating(null)} />}
      {creating === 'project' && <ProjectSheet onClose={() => setCreating(null)} />}
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase">{title}</h2>
      <ul className="divide-y divide-stone-100 rounded-xl bg-white">{children}</ul>
    </section>
  )
}

function Row({
  title,
  sub,
  notes = [],
  value,
  onClick,
  to,
}: {
  title: string
  sub?: string
  notes?: string[]
  value?: string
  onClick?: () => void
  to?: string
}) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {sub && <p className="truncate text-sm text-stone-500">{sub}</p>}
        {notes.map((n) => (
          <p key={n} className="truncate text-sm tabular-nums text-stone-500">
            {n}
          </p>
        ))}
      </div>
      {value && <span className="shrink-0 tabular-nums text-sm text-stone-500">{value}</span>}
    </>
  )
  const cls = 'flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left'
  return (
    <li>
      {to ? (
        <Link to={to} className={`${cls} active:bg-stone-50`}>
          {content}
        </Link>
      ) : onClick ? (
        <button type="button" className={`${cls} active:bg-stone-50`} onClick={onClick}>
          {content}
        </button>
      ) : (
        <div className={cls}>{content}</div>
      )}
    </li>
  )
}
