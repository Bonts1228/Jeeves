import { useLiveQuery } from 'dexie-react-hooks'
import type { ReactNode } from 'react'
import { db } from '../db/db'
import { formatDuration } from '../lib/time'
import type { GoalType } from '../types'

const GOAL_TYPE: Record<GoalType, string> = {
  set_path: 'Set path',
  open_path: 'Open path',
  recurring: 'Recurring',
}

// M1: read-only view of what's in the database. Editing comes in M2.
export function Backlog() {
  const inboxCount = useLiveQuery(() => db.inbox.count())
  const goals = useLiveQuery(() => db.goals.toArray())
  const projects = useLiveQuery(() => db.projects.toArray())
  const tasks = useLiveQuery(() => db.tasks.where('status').anyOf('backlog', 'scheduled', 'done').toArray())

  if (inboxCount === undefined || !goals || !projects || !tasks) return null

  const open = tasks.filter((t) => t.status !== 'done')
  const loose = open.filter((t) => !t.goalId && !t.projectId)

  return (
    <div className="space-y-6">
      <div className="flex min-h-14 items-center justify-between rounded-xl bg-white px-4">
        <span className="font-medium">Inbox</span>
        <span className="tabular-nums text-stone-500">{inboxCount}</span>
      </div>

      <Group title="Goals">
        {goals.map((g) => (
          <Row
            key={g.id}
            title={g.title}
            sub={GOAL_TYPE[g.type] + (g.target ? ` · ${g.target} per ${g.period}` : '')}
            value={`${open.filter((t) => t.goalId === g.id).length} tasks`}
          />
        ))}
      </Group>

      <Group title="Projects">
        {projects.map((p) => {
          const steps = tasks.filter((t) => t.projectId === p.id)
          const done = steps.filter((t) => t.status === 'done').length
          return <Row key={p.id} title={p.title} value={`${done} of ${steps.length} steps`} />
        })}
      </Group>

      <Group title={`Tasks · ${loose.length}`}>
        {loose.map((t) => (
          <Row key={t.id} title={t.title} sub={t.due ? `Due ${t.due}` : undefined} value={formatDuration(t.estimate)} />
        ))}
      </Group>
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

function Row({ title, sub, value }: { title: string; sub?: string; value: string }) {
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2">
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        {sub && <p className="text-sm text-stone-500">{sub}</p>}
      </div>
      <span className="shrink-0 tabular-nums text-sm text-stone-500">{value}</span>
    </li>
  )
}
