import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, newId } from '../db/db'
import { saveProject } from '../db/goals'
import { hasOpenSteps, waitCandidates } from '../lib/holdback'
import { HOUSEKEEPING_ID, type ID, type Project } from '../types'
import { DeleteListConfirm } from './DeleteListConfirm'
import { Field } from './GoalSheet'
import { Sheet } from './Sheet'
import { dangerBtn, input, primaryBtn, secondaryBtn } from './ui'

// goalId: the goal a new project goes under (from that goal's screen), else Housekeeping.
export function ProjectSheet({
  project,
  goalId = HOUSEKEEPING_ID,
  onClose,
  onDeleted,
}: {
  project?: Project
  goalId?: ID
  onClose: () => void
  onDeleted?: () => void
}) {
  const goals = useLiveQuery(() => db.goals.toArray())
  const projects = useLiveQuery(() => db.projects.toArray())
  const openTasks = useLiveQuery(() => db.tasks.where('status').anyOf('backlog', 'scheduled').toArray())
  const [draft, setDraft] = useState<Omit<Project, 'id'>>(() => project ?? { title: '', goalId })
  const [deleting, setDeleting] = useState(false)
  if (!goals || !projects || !openTasks) return null

  const set = (patch: Partial<Project>) => setDraft((d) => ({ ...d, ...patch }))
  const valid = !!draft.title.trim() && goals.some((g) => g.id === draft.goalId)
  const toggledManual = project && !!project.manualOnly !== !!draft.manualOnly

  const save = async () => {
    if (!valid) return
    await saveProject({
      id: project?.id ?? newId(),
      title: draft.title.trim(),
      goalId: draft.goalId,
      ...(draft.manualOnly && { manualOnly: true }),
      ...(draft.notBefore && { notBefore: draft.notBefore }),
      ...(draft.startsAfterProjectId && { startsAfterProjectId: draft.startsAfterProjectId }),
    })
    onClose()
  }

  return (
    <Sheet title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      {deleting && project ? (
        <DeleteListConfirm
          kind="project"
          id={project.id}
          title={project.title}
          onCancel={() => setDeleting(false)}
          onDeleted={onDeleted ?? onClose}
        />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Field label="Title">
            <input className={input} value={draft.title} onChange={(e) => set({ title: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Goal" hint="Done steps count towards it. Its area is the goal's.">
            <select className={input} value={draft.goalId} onChange={(e) => set({ goalId: e.target.value })}>
              {[...goals].sort((a, b) => +!!a.isHousekeeping - +!!b.isHousekeeping).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 accent-stone-900"
              checked={!!draft.manualOnly}
              onChange={(e) => set({ manualOnly: e.target.checked })}
            />
            <span>
              Only when I add it
              <span className="block text-sm text-stone-500">
                Never auto-placed unless due or overdue. Steps have no order.
              </span>
            </span>
          </label>
          <Field label="Not before (optional)" hint="Held back under Later until this date.">
            <div className="flex gap-2">
              <input
                type="date"
                className={`${input} flex-1`}
                value={draft.notBefore ?? ''}
                onChange={(e) => set({ notBefore: e.target.value || undefined })}
              />
              {draft.notBefore && (
                <button type="button" className={secondaryBtn} onClick={() => set({ notBefore: undefined })}>
                  Clear
                </button>
              )}
            </div>
          </Field>
          <Field label="Starts after (optional)" hint="Held back under Later until that project's steps are all done.">
            <select
              className={input}
              value={draft.startsAfterProjectId ?? ''}
              onChange={(e) => set({ startsAfterProjectId: e.target.value || undefined })}
            >
              <option value="">None</option>
              {waitCandidates(project?.id, projects).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
          {draft.startsAfterProjectId && !hasOpenSteps(draft.startsAfterProjectId, openTasks) && (
            <p className="text-sm text-amber-700">It has nothing open, so this project starts now.</p>
          )}
          {toggledManual && (
            <p className="text-sm text-amber-700">
              {draft.manualOnly ? 'Its steps lose their order.' : 'Its tasks become steps, oldest first.'}
            </p>
          )}
          <div className="flex gap-2 pt-2">
            {project && (
              <button type="button" className={dangerBtn} onClick={() => setDeleting(true)}>
                Delete
              </button>
            )}
            <button type="button" className={`${secondaryBtn} ml-auto`} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryBtn} disabled={!valid}>
              Save
            </button>
          </div>
        </form>
      )}
    </Sheet>
  )
}
