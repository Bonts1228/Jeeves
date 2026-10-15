import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, newId } from '../db/db'
import { saveProject } from '../db/goals'
import type { Project } from '../types'
import { DeleteListConfirm } from './DeleteListConfirm'
import { Field } from './GoalSheet'
import { Sheet } from './Sheet'
import { dangerBtn, input, primaryBtn, secondaryBtn } from './ui'

export function ProjectSheet({
  project,
  onClose,
  onDeleted,
}: {
  project?: Project
  onClose: () => void
  onDeleted?: () => void
}) {
  const areas = useLiveQuery(() => db.areas.toArray())
  const goals = useLiveQuery(() => db.goals.toArray())
  const [draft, setDraft] = useState<Omit<Project, 'id'>>(() => project ?? { title: '', areaId: '' })
  const [deleting, setDeleting] = useState(false)
  if (!areas || !goals) return null

  const set = (patch: Partial<Project>) => setDraft((d) => ({ ...d, ...patch }))
  const areaId = draft.areaId || areas[0]?.id
  const valid = !!draft.title.trim() && !!areaId
  const toggledManual = project && !!project.manualOnly !== !!draft.manualOnly

  const save = async () => {
    if (!valid) return
    await saveProject({
      id: project?.id ?? newId(),
      title: draft.title.trim(),
      areaId: areaId!,
      ...(draft.goalId && { goalId: draft.goalId }),
      ...(draft.manualOnly && { manualOnly: true }),
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
          <Field label="Area">
            <select className={input} value={areaId} onChange={(e) => set({ areaId: e.target.value })}>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Feeds goal (optional)" hint="Done steps count towards it.">
            <select className={input} value={draft.goalId ?? ''} onChange={(e) => set({ goalId: e.target.value || undefined })}>
              <option value="">None</option>
              {goals.map((g) => (
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
                Never auto-placed unless due or overdue. Steps have no order. For life admin like Housekeeping.
              </span>
            </span>
          </label>
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
