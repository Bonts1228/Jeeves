import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { GoalSheet } from '../components/GoalSheet'
import { secondaryBtn } from '../components/ui'
import { db } from '../db/db'
import { dayMonth, isoDate } from '../lib/dates'
import { heldBackLabel, isHeldBack } from '../lib/holdback'
import { goalNumber, lastDetails, nextStep, paceLabel, projectNumber } from '../lib/progress'
import { useNow } from '../lib/use-now'
import type { Goal, GoalType, Task } from '../types'

const GOAL_TYPE: Record<GoalType, string> = {
  open_path: 'Open path',
  recurring: 'Recurring',
}

// One tree: each goal (Housekeeping last) with its projects under it, then a row for the goal's own
// tasks; held-back projects wait under Later. Goals, projects and task rows open their own screens.
export function Backlog() {
  const [creating, setCreating] = useState(false)
  const now = useNow() // the period rolls over at midnight
  const areas = useLiveQuery(() => db.areas.toArray())
  const goals = useLiveQuery(() => db.goals.toArray())
  const projects = useLiveQuery(() => db.projects.toArray())
  const tasks = useLiveQuery(() => db.tasks.where('status').anyOf('backlog', 'scheduled', 'done').toArray())
  const logs = useLiveQuery(() => db.logEntries.toArray())

  if (!areas || !goals || !projects || !tasks || !logs) return null

  const today = isoDate(now)
  const isOpen = (t: Task) => t.status !== 'done'
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? 'area'
  const later = projects.filter((p) => isHeldBack(p, today))
  const ordered = [...goals].sort((a, b) => +!!a.isHousekeeping - +!!b.isHousekeeping)

  const goalSub = (g: Goal) => {
    if (g.isHousekeeping) return 'Everything without a core goal'
    return [GOAL_TYPE[g.type], g.servedByBlocks && `Every ${areaName(g.areaId)} block`].filter(Boolean).join(' · ')
  }
  // Under the goal: its numbers (pace against target, time left, deadline), then the latest details
  const goalNotes = (g: Goal) => {
    const numbers = [paceLabel(g, logs, now), g.deadline && `By ${dayMonth(g.deadline)}`].filter(Boolean).join(' · ')
    const last = lastDetails(g, logs)
    return [numbers, last && `Last: ${last}`].filter(Boolean)
  }

  return (
    <div className="space-y-6">
      {ordered.map((g) => {
        const own = tasks.filter((t) => t.goalId === g.id && !t.projectId && isOpen(t))
        return (
          <ul key={g.id} className="divide-y divide-stone-100 rounded-xl bg-white">
            <Row
              title={g.title}
              sub={goalSub(g)}
              notes={goalNotes(g)}
              value={goalNumber(g, tasks, logs, now)}
              to={`/goals/${g.id}`}
            />
            {projects
              .filter((p) => p.goalId === g.id && !isHeldBack(p, today))
              .map((p) => {
                const next = nextStep(tasks.filter((t) => t.projectId === p.id))
                return (
                  <Row
                    key={p.id}
                    nested
                    title={p.title}
                    sub={p.manualOnly ? 'Only when you add it' : next && `Next: ${next.title}`}
                    value={projectNumber(p, tasks)}
                    to={`/projects/${p.id}`}
                  />
                )
              })}
            {own.length > 0 && (
              <Row nested title="Tasks" sub={own.slice(0, 2).map((t) => t.title).join(', ')} value={`${own.length} open`} to={`/goals/${g.id}`} />
            )}
          </ul>
        )
      })}

      <button type="button" className={`${secondaryBtn} w-full`} onClick={() => setCreating(true)}>
        + Goal
      </button>

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
      {creating && <GoalSheet onClose={() => setCreating(false)} />}
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
  nested = false,
}: {
  title: string
  sub?: string
  notes?: string[]
  value?: string
  onClick?: () => void
  to?: string
  nested?: boolean // a project or task row under its goal
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
  const cls = `flex min-h-14 w-full items-center gap-3 py-2 pr-4 text-left ${nested ? 'pl-8' : 'pl-4'}`
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
