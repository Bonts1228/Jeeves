import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, useState } from 'react'
import { db } from '../db/db'
import { cleanDetails, detailFieldsOf } from '../lib/progress'
import { capitalise } from '../lib/task-fields'
import type { Goal } from '../types'
import { Sheet } from './Sheet'
import { input, primaryBtn, secondaryBtn } from './ui'

type Details = Record<string, string> | undefined

// The goal's detail fields ("role", "company"), one input each. The last values logged show as
// placeholders, not as values. On a tick: Skip still logs (no details), Save logs with what's filled
// in. Editing an entry later: initial holds its details, and the second button cancels instead.
export function DetailsForm({
  goal,
  initial,
  onSave,
  onSkip,
  onCancel,
}: {
  goal: Goal
  initial?: Record<string, string>
  onSave: (details: Details) => void
  onSkip?: () => void
  onCancel?: () => void
}) {
  const fields = detailFieldsOf(goal)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f, initial?.[f] ?? ''])),
  )
  const last = useLiveQuery(async () => {
    const entries = await db.logEntries.where('goalId').equals(goal.id).sortBy('completedAt')
    return entries.reverse().find((e) => e.details)?.details ?? {}
  }, [goal.id])

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(cleanDetails(values))
      }}
    >
      {fields.map((f, i) => (
        <label key={f} className="block">
          <span className="mb-1 block text-sm font-medium text-stone-600">{capitalise(f)}</span>
          <input
            autoFocus={i === 0}
            autoComplete="off"
            enterKeyHint={i === fields.length - 1 ? 'done' : 'next'}
            className={`${input} w-full`}
            placeholder={last?.[f] ?? ''}
            value={values[f]}
            onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
          />
        </label>
      ))}
      <div className="flex gap-2 pt-1">
        {onSkip ? (
          <button type="button" className={`${secondaryBtn} flex-1`} onClick={onSkip}>
            Skip
          </button>
        ) : (
          <button type="button" className={`${secondaryBtn} flex-1`} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className={`${primaryBtn} flex-1`}>
          Save
        </button>
      </div>
    </form>
  )
}

interface Asking {
  goal: Goal
  finish: (details: Details) => Promise<unknown>
}

// The details step before a tick is written. ask(goal, finish): if the goal records details, show
// the form first (Save or Skip both finish; cancelling writes nothing); else finish straight away.
// form: the form's body, for a sheet that shows it in place of its own content; sheet: the same in
// a sheet of its own.
export function useDetailsStep() {
  const [asking, setAsking] = useState<Asking | null>(null)
  const ask = async (goal: Goal | undefined, finish: Asking['finish']) => {
    if (goal && detailFieldsOf(goal).length) setAsking({ goal, finish })
    else await finish(undefined)
  }
  const done = async (details: Details) => {
    if (!asking) return
    setAsking(null)
    await asking.finish(details)
  }
  const cancel = () => setAsking(null)
  const form: ReactNode = asking && (
    <DetailsForm key={asking.goal.id} goal={asking.goal} onSave={done} onSkip={() => done(undefined)} />
  )
  const sheet: ReactNode = asking && (
    <Sheet title={`${asking.goal.title} · details`} onClose={cancel}>
      {form}
    </Sheet>
  )
  return { ask, asking: asking?.goal, form, sheet, cancel }
}
