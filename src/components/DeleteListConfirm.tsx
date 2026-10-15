import { useEffect, useState } from 'react'
import { type Affected, affectedBy, deleteGoalOrProject } from '../db/goals'
import type { ID } from '../types'
import { secondaryBtn } from './ui'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const redBtn = 'h-11 rounded-lg bg-red-700 px-4 font-medium text-white'
const redOutlineBtn = 'h-11 rounded-lg border border-red-700 bg-white px-4 font-medium text-red-800'

// Confirm deleting a goal or project. With open tasks, asks whether to keep them as loose Backlog
// tasks or delete them too; never orphans them silently. Done tasks always stay as history.
export function DeleteListConfirm({
  kind,
  id,
  title,
  onCancel,
  onDeleted,
}: {
  kind: 'goal' | 'project'
  id: ID
  title: string
  onCancel: () => void
  onDeleted: () => void
}) {
  const [affected, setAffected] = useState<Affected | null>(null)
  useEffect(() => {
    affectedBy(kind, id).then(setAffected)
  }, [kind, id])
  if (!affected) return null

  const remove = async (mode: 'keep' | 'delete') => {
    await deleteGoalOrProject(kind, id, mode)
    onDeleted()
  }
  const { open, done, projects } = affected

  return (
    <div className="space-y-3 rounded-xl bg-red-50 p-3 text-red-900">
      <p className="font-medium">
        Delete {kind} “{title}”?
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {open > 0 && <li>{plural(open, 'open task')}: keep them in the Backlog or delete them too.</li>}
        {done > 0 && <li>{plural(done, 'done task')} {done === 1 ? 'stays' : 'stay'} as history.</li>}
        {projects > 0 && <li>{plural(projects, 'project')} will stop feeding this goal.</li>}
        {open + done + projects === 0 && <li>Nothing else is linked to it.</li>}
      </ul>
      <div className="flex flex-col gap-2">
        {open > 0 ? (
          <>
            <button type="button" className={redOutlineBtn} onClick={() => remove('keep')}>
              Delete {kind}, keep {plural(open, 'task')} in Backlog
            </button>
            <button type="button" className={redBtn} onClick={() => remove('delete')}>
              Delete {kind} and its {plural(open, 'open task')}
            </button>
          </>
        ) : (
          <button type="button" className={redBtn} onClick={() => remove('keep')}>
            Delete {kind}
          </button>
        )}
        <button type="button" className={secondaryBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
