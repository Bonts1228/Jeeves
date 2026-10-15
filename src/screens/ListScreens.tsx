import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Capture } from '../components/Capture'
import { GoalSheet } from '../components/GoalSheet'
import { BackIcon } from '../components/icons'
import { ProjectSheet } from '../components/ProjectSheet'
import { TaskSheet } from '../components/TaskSheet'
import { secondaryBtn } from '../components/ui'
import { db } from '../db/db'
import { moveStep, type StepList, stepsOf } from '../db/steps'
import { isoDate } from '../lib/dates'
import { goalProgress } from '../lib/progress'
import { dayLabel, taskFacts } from '../lib/task-fields'
import type { Task } from '../types'

const GOAL_TYPE = { set_path: 'Set path', open_path: 'Open path', recurring: 'Recurring' }

export function GoalScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const goal = useLiveQuery(() => db.goals.get(id), [id])
  const logs = useLiveQuery(() => db.logEntries.where('goalId').equals(id).toArray(), [id])
  const feeders = useLiveQuery(() => db.projects.filter((p) => p.goalId === id).toArray(), [id])
  const area = useLiveQuery(async () => (goal ? db.areas.get(goal.areaId) : undefined), [goal?.areaId])
  const [editing, setEditing] = useState(false)
  const [today] = useState(() => isoDate(new Date()))
  if (goal === undefined || !logs || !feeders) return <Page title="" onEdit={() => {}} />

  const progress = goalProgress(goal, logs)
  const ordered = goal.type === 'set_path'
  const facts = [
    GOAL_TYPE[goal.type],
    progress && `${progress.done} of ${progress.target} this ${goal.period}`,
    goal.servedByBlocks && `Every ${area?.name ?? ''} block counts`,
    goal.deadline && `By ${dayLabel(goal.deadline, today)}`,
    goal.detailFields?.length && `Records ${goal.detailFields.join(', ')}`,
  ].filter(Boolean)

  return (
    <Page title={goal.title} onEdit={() => setEditing(true)}>
      <p className="text-sm text-stone-500">{facts.join(' · ')}</p>
      {feeders.length > 0 && (
        <p className="text-sm">
          Fed by{' '}
          {feeders.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <Link to={`/projects/${p.id}`} className="font-medium underline underline-offset-2">
                {p.title}
              </Link>
            </span>
          ))}
        </p>
      )}
      {goal.servedByBlocks && goal.type === 'recurring' ? (
        <p className="rounded-xl bg-white p-4 text-sm text-stone-600">
          Each {area?.name ?? ''} block you tick counts one. Ticking blocks arrives with the day view (M4), so this stays
          at 0 until then.
        </p>
      ) : (
        <Steps list={{ goalId: goal.id }} ordered={ordered} />
      )}
      {editing && <GoalSheet goal={goal} onClose={() => setEditing(false)} onDeleted={() => navigate('/backlog')} />}
    </Page>
  )
}

export function ProjectScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const project = useLiveQuery(() => db.projects.get(id), [id])
  const goal = useLiveQuery(async () => (project?.goalId ? db.goals.get(project.goalId) : undefined), [project?.goalId])
  const [editing, setEditing] = useState(false)
  if (project === undefined) return <Page title="" onEdit={() => {}} />

  return (
    <Page title={project.title} onEdit={() => setEditing(true)}>
      <p className="text-sm text-stone-500">
        {project.manualOnly ? 'Only when you add it' : 'Project'}
        {goal && (
          <>
            {' · Feeds '}
            <Link to={`/goals/${goal.id}`} className="font-medium text-stone-900 underline underline-offset-2">
              {goal.title}
            </Link>
          </>
        )}
      </p>
      <Steps list={{ projectId: project.id }} ordered={!project.manualOnly} />
      {editing && <ProjectSheet project={project} onClose={() => setEditing(false)} onDeleted={() => navigate('/backlog')} />}
    </Page>
  )
}

function Page({ title, onEdit, children }: { title: string; onEdit: () => void; children?: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-md pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 flex items-center gap-1 bg-stone-50/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
        <Link
          to="/backlog"
          aria-label="Back to Backlog"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-600 active:bg-stone-200"
        >
          <BackIcon />
        </Link>
        <h1 className="min-w-0 flex-1 truncate py-3 text-2xl font-semibold">{title}</h1>
        {title && (
          <button type="button" onClick={onEdit} className="h-11 rounded-full px-4 font-medium text-stone-600 active:bg-stone-200">
            Edit
          </button>
        )}
      </header>
      <main className="space-y-4 px-4 pt-1">{children}</main>
    </div>
  )
}

// Ordered lists show every step in order (done ones in place, greyed) with ↑/↓ on open steps.
// Unordered lists show open tasks oldest first, then done ones.
function Steps({ list, ordered }: { list: StepList; ordered: boolean }) {
  const key = JSON.stringify(list)
  const steps = useLiveQuery(() => stepsOf(list), [key])
  const [today] = useState(() => isoDate(new Date()))
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  if (!steps) return null

  const isOpen = (t: Task) => t.status === 'backlog' || t.status === 'scheduled'
  const openSteps = steps.filter(isOpen)
  const shown = ordered ? steps : [...openSteps, ...steps.filter((t) => !isOpen(t))]
  const done = steps.length - openSteps.length

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase">
        {ordered ? `Steps · ${done} of ${steps.length} done` : `Tasks · ${openSteps.length} open${done ? `, ${done} done` : ''}`}
      </h2>
      <ul className="divide-y divide-stone-100 rounded-xl bg-white">
        {shown.length === 0 && <li className="px-4 py-3 text-stone-500">No {ordered ? 'steps' : 'tasks'} yet.</li>}
        {shown.map((t) => {
          const i = openSteps.indexOf(t)
          return (
            <li key={t.id} className="flex items-center">
              <button
                type="button"
                onClick={() => setOpen(t.id)}
                className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left active:bg-stone-50 ${
                  isOpen(t) ? '' : 'text-stone-400'
                } ${ordered && isOpen(t) ? '' : 'pr-4'}`}
              >
                {ordered && <span className="w-5 shrink-0 text-right tabular-nums text-sm text-stone-400">{t.order}</span>}
                <span className="min-w-0 flex-1">
                  <span className={`block font-medium ${isOpen(t) ? '' : 'line-through'}`}>{t.title}</span>
                  <span className="block text-sm text-stone-500">{taskFacts(t, today)}</span>
                </span>
              </button>
              {ordered && isOpen(t) && (
                <span className="flex shrink-0 pr-1">
                  <MoveButton label={`Move ${t.title} up`} disabled={i === 0} onClick={() => moveStep(t.id, -1)}>
                    ↑
                  </MoveButton>
                  <MoveButton
                    label={`Move ${t.title} down`}
                    disabled={i === openSteps.length - 1}
                    onClick={() => moveStep(t.id, 1)}
                  >
                    ↓
                  </MoveButton>
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <button type="button" className={`${secondaryBtn} mt-3 w-full`} onClick={() => setAdding(true)}>
        + Add {ordered ? 'step' : 'task'}
      </button>
      {open && <TaskSheet taskId={open} onClose={() => setOpen(null)} />}
      {adding && (
        <Capture
          init={{ link: 'projectId' in list ? { projectId: list.projectId } : { goalId: list.goalId } }}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  )
}

function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-lg text-stone-600 active:bg-stone-100 disabled:opacity-25"
    >
      {children}
    </button>
  )
}
