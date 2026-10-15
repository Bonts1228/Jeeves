import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, useState } from 'react'
import { db, newId } from '../db/db'
import { saveGoal } from '../db/goals'
import type { Goal, GoalType } from '../types'
import { DeleteListConfirm } from './DeleteListConfirm'
import { Sheet } from './Sheet'
import { dangerBtn, input, primaryBtn, secondaryBtn } from './ui'

const TYPES: { type: GoalType; label: string; hint: string }[] = [
  { type: 'set_path', label: 'Set path', hint: 'Ordered steps to a finish line.' },
  { type: 'open_path', label: 'Open path', hint: 'Any number of tasks towards a target.' },
  { type: 'recurring', label: 'Recurring', hint: 'A habit counted each week or month.' },
]

type Draft = Omit<Goal, 'id' | 'detailFields'> & { id?: string; detailFields: string }

export function GoalSheet({ goal, onClose, onDeleted }: { goal?: Goal; onClose: () => void; onDeleted?: () => void }) {
  const areas = useLiveQuery(() => db.areas.toArray())
  const [draft, setDraft] = useState<Draft>(() => ({
    ...(goal ?? { title: '', type: 'set_path' as const, areaId: '' }),
    detailFields: goal?.detailFields?.join(', ') ?? '',
  }))
  const [deleting, setDeleting] = useState(false)
  if (!areas) return null

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const areaId = draft.areaId || areas[0]?.id
  const counted = draft.type !== 'set_path'
  const valid = !!draft.title.trim() && !!areaId && (!counted || (draft.target ?? 0) > 0)
  const areaName = areas.find((a) => a.id === areaId)?.name ?? 'area'
  const typeChanged = goal && goal.type !== draft.type
  const fromOrdered = goal?.type === 'set_path'

  const save = async () => {
    if (!valid) return
    const fields = draft.detailFields
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
    const next: Goal = {
      id: draft.id ?? newId(),
      title: draft.title.trim(),
      type: draft.type,
      areaId: areaId!,
      ...(counted && { target: draft.target, period: draft.period ?? 'week' }),
      ...(draft.deadline && { deadline: draft.deadline }),
      ...(draft.type === 'recurring' && draft.servedByBlocks && { servedByBlocks: true }),
      ...(fields.length && { detailFields: fields }),
    }
    await saveGoal(next)
    onClose()
  }

  return (
    <Sheet title={goal ? 'Edit goal' : 'New goal'} onClose={onClose}>
      {deleting && goal ? (
        <DeleteListConfirm
          kind="goal"
          id={goal.id}
          title={goal.title}
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

          <div>
            <div role="group" aria-label="Type" className="grid grid-cols-3 gap-1">
              {TYPES.map(({ type, label }) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={draft.type === type}
                  onClick={() => set({ type })}
                  className={`h-11 rounded-lg text-sm font-medium ${
                    draft.type === type ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-sm text-stone-500">{TYPES.find((t) => t.type === draft.type)?.hint}</p>
            {typeChanged && (
              <p className="mt-1 text-sm text-amber-700">
                {fromOrdered ? 'Its steps lose their order.' : draft.type === 'set_path' ? 'Its tasks become steps, oldest first.' : ''}
              </p>
            )}
          </div>

          <Field label="Area">
            <select className={input} value={areaId} onChange={(e) => set({ areaId: e.target.value })}>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          {counted && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Target">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  className={input}
                  value={draft.target ?? ''}
                  onChange={(e) => set({ target: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined })}
                />
              </Field>
              <Field label="Per">
                <select
                  className={input}
                  value={draft.period ?? 'week'}
                  onChange={(e) => set({ period: e.target.value as 'week' | 'month' })}
                >
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </Field>
            </div>
          )}

          {draft.type === 'recurring' && (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="h-5 w-5 accent-stone-900"
                checked={!!draft.servedByBlocks}
                onChange={(e) => set({ servedByBlocks: e.target.checked })}
              />
              <span>
                Every {areaName} block counts{' '}
                <span className="text-sm text-stone-500">(tick the block, no tasks needed)</span>
              </span>
            </label>
          )}

          <Field label="Deadline (optional)">
            <input type="date" className={input} value={draft.deadline ?? ''} onChange={(e) => set({ deadline: e.target.value || undefined })} />
          </Field>

          <Field label="Details to record when ticked (optional)" hint="Comma-separated, e.g. role, company">
            <input className={input} value={draft.detailFields} onChange={(e) => set({ detailFields: e.target.value })} autoComplete="off" />
          </Field>

          <div className="flex gap-2 pt-2">
            {goal && (
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

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="text-xs text-stone-500">{hint}</span>}
    </label>
  )
}
