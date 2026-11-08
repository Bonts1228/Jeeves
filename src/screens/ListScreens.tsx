import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Capture } from '../components/Capture'
import { DetailsForm } from '../components/DetailsForm'
import { GoalSheet } from '../components/GoalSheet'
import { DoneBanner } from '../components/DoneBanner'
import { BackIcon } from '../components/icons'
import { ProjectSheet } from '../components/ProjectSheet'
import { Sheet } from '../components/Sheet'
import { TaskSheet } from '../components/TaskSheet'
import { secondaryBtn } from '../components/ui'
import { db } from '../db/db'
import { updateDetails } from '../db/goals'
import { moveStep, type StepList, stepsOf } from '../db/steps'
import { isoDate } from '../lib/dates'
import { heldBackLabel, isHeldBack } from '../lib/holdback'
import { detailFieldsOf, detailsText, goalProgress, nextStep, projectNumber } from '../lib/progress'
import { capitalise, dayLabel, taskFacts } from '../lib/task-fields'
import type { Goal, LogEntry, Task } from '../types'

const GOAL_TYPE = { open_path: 'Open path', recurring: 'Recurring' }

export function GoalScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const goal = useLiveQuery(() => db.goals.get(id), [id])
  const logs = useLiveQuery(() => db.logEntries.where('goalId').equals(id).toArray(), [id])
  const area = useLiveQuery(async () => (goal ? db.areas.get(goal.areaId) : undefined), [goal?.areaId])
  const [editing, setEditing] = useState(false)
  const [today] = useState(() => isoDate(new Date()))
  if (goal === undefined || !logs) return <Page title="" onEdit={() => {}} />

  const progress = goalProgress(goal, logs)
  const facts = [
    goal.isHousekeeping ? 'Everything without a core goal' : GOAL_TYPE[goal.type],
    progress && `${progress.done} of ${progress.target} this ${goal.period}`,
    goal.servedByBlocks && `Every ${area?.name ?? ''} block counts`,
    goal.deadline && `By ${dayLabel(goal.deadline, today)}`,
    goal.detailFields?.length && `Records ${goal.detailFields.join(', ')}`,
  ].filter(Boolean)

  return (
    <Page title={goal.title} onEdit={() => setEditing(true)}>
      <p className="text-sm text-stone-500">{facts.join(' · ')}</p>
      <Projects goal={goal} today={today} />
      {goal.servedByBlocks && goal.type === 'recurring' ? (
        <p className="rounded-xl bg-white p-4 text-sm text-stone-600">
          Each {area?.name ?? ''} block you tick counts one. Tasks for it count when done outside those blocks.
        </p>
      ) : (
        <Steps list={{ goalId: goal.id }} ordered={false} />
      )}
      <Recent goal={goal} logs={logs} today={today} />
      {editing && <GoalSheet goal={goal} onClose={() => setEditing(false)} onDeleted={() => navigate('/backlog')} />}
    </Page>
  )
}

// A goal's projects, each with its number, then + Project (under this goal). Held-back ones say why.
function Projects({ goal, today }: { goal: Goal; today: string }) {
  const projects = useLiveQuery(() => db.projects.where('goalId').equals(goal.id).toArray(), [goal.id])
  const all = useLiveQuery(() => db.projects.toArray())
  const tasks = useLiveQuery(
    () => db.tasks.where('goalId').equals(goal.id).filter((t) => t.status !== 'deleted').toArray(),
    [goal.id],
  )
  const [adding, setAdding] = useState(false)
  if (!projects || !all || !tasks) return null

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase">Projects</h2>
      {projects.length > 0 && (
        <ul className="divide-y divide-stone-100 rounded-xl bg-white">
          {projects.map((p) => {
            const steps = tasks.filter((t) => t.projectId === p.id)
            const next = nextStep(steps)
            const sub = isHeldBack(p, today)
              ? heldBackLabel(p, all, tasks)
              : p.manualOnly
                ? 'Only when you add it'
                : next && `Next: ${next.title}`
            return (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 active:bg-stone-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.title}</span>
                    {sub && <span className="block truncate text-sm text-stone-500">{sub}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-stone-500">{projectNumber(p, tasks)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <button type="button" className={`${secondaryBtn} mt-3 w-full`} onClick={() => setAdding(true)}>
        + Project
      </button>
      {adding && <ProjectSheet goalId={goal.id} onClose={() => setAdding(false)} />}
    </section>
  )
}

const RECENT = 10

// The latest log entries for a goal: when, what (task or block) and its details. With detail fields,
// tapping an entry edits its details (fill in a skipped form); when and what never change here.
function Recent({ goal, logs, today }: { goal: Goal; logs: LogEntry[]; today: string }) {
  const recent = [...logs].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, RECENT)
  const what = useLiveQuery(async () => {
    const tasks = await db.tasks.bulkGet(recent.flatMap((l) => (l.taskId ? [l.taskId] : [])))
    const blocks = await db.blocks.bulkGet(recent.flatMap((l) => (l.blockId ? [l.blockId] : [])))
    return new Map([
      ...tasks.flatMap((t) => (t ? [[t.id, t.title] as const] : [])),
      ...blocks.flatMap((b) => (b ? [[b.id, `Block ${b.start}–${b.end}`] as const] : [])),
    ])
  }, [recent.map((l) => l.id).join()])
  const [editing, setEditing] = useState<LogEntry | null>(null)
  if (!recent.length || !what) return null
  const fields = detailFieldsOf(goal).length > 0

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase">Recent</h2>
      <ul className="divide-y divide-stone-100 rounded-xl bg-white">
        {recent.map((l) => {
          const when = capitalise(dayLabel(isoDate(new Date(l.completedAt)), today))
          const source = what.get(l.taskId ?? l.blockId ?? '')
          const content = (
            <>
              <span className="block font-medium">{detailsText(goal, l.details) || (fields ? 'No details' : 'Done')}</span>
              <span className="block truncate text-sm text-stone-500">{[when, source].filter(Boolean).join(' · ')}</span>
            </>
          )
          return (
            <li key={l.id}>
              {fields ? (
                <button type="button" className="block min-h-14 w-full px-4 py-2 text-left active:bg-stone-50" onClick={() => setEditing(l)}>
                  {content}
                </button>
              ) : (
                <div className="min-h-14 px-4 py-2">{content}</div>
              )}
            </li>
          )
        })}
      </ul>
      {editing && (
        <Sheet title={`${goal.title} · details`} onClose={() => setEditing(null)}>
          <DetailsForm
            goal={goal}
            initial={editing.details}
            onSave={async (details) => {
              await updateDetails(editing.id, details)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        </Sheet>
      )}
    </section>
  )
}

export function ProjectScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const project = useLiveQuery(() => db.projects.get(id), [id])
  const goal = useLiveQuery(async () => (project ? db.goals.get(project.goalId) : undefined), [project?.goalId])
  const [editing, setEditing] = useState(false)
  if (project === undefined) return <Page title="" onEdit={() => {}} />

  return (
    <Page title={project.title} onEdit={() => setEditing(true)}>
      <p className="text-sm text-stone-500">
        {project.manualOnly ? 'Only when you add it' : 'Project'}
        {goal && (
          <>
            {' · Under '}
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
      <DoneBanner />
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
