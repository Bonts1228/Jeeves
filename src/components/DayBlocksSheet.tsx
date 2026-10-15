import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { blockEditProblem, ensureBlocks } from '../db/blocks'
import { addBlock, deleteBlock, updateBlockTimes } from '../db/day-blocks'
import { db } from '../db/db'
import { addDays, isoDate } from '../lib/dates'
import { capitalise, dayLabel } from '../lib/task-fields'
import { blockMinutes, formatDuration, toMinutes } from '../lib/time'
import type { Area, Block, ID, ISODate, Task } from '../types'
import { Sheet } from './Sheet'
import { dangerBtn, input, primaryBtn, secondaryBtn } from './ui'

// Edit one day's blocks (today or tomorrow): times, delete, add an empty one. Templates are untouched.
// areaId presets the new block's area; onAdded runs after a block is added (e.g. a moved session).
export function DayBlocksSheet({
  date: initial,
  areaId,
  onAdded,
  onClose,
}: {
  date: ISODate
  areaId?: ID
  onAdded?: () => void
  onClose: () => void
}) {
  const [now] = useState(() => new Date())
  const today = isoDate(now)
  const [date, setDate] = useState(initial)
  const [ready, setReady] = useState<ISODate | null>(null)
  useEffect(() => {
    let live = true
    ensureBlocks(date).then(() => live && setReady(date))
    return () => {
      live = false
    }
  }, [date])

  const areas = useLiveQuery(() => db.areas.toArray())
  const blocks = useLiveQuery(() => db.blocks.where('date').equals(date).toArray(), [date])
  const tasks = useLiveQuery(
    () => db.tasks.where('date').equals(date).filter((t) => t.status === 'scheduled').toArray(),
    [date],
  )
  const loaded = ready === date && areas && blocks && tasks

  return (
    <Sheet title="Edit blocks" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2 rounded-xl bg-stone-100 p-1">
          {[today, addDays(today, 1)].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === date}
              onClick={() => setDate(d)}
              className={`h-11 flex-1 rounded-lg font-medium ${d === date ? 'bg-white shadow-sm' : 'text-stone-600'}`}
            >
              {capitalise(dayLabel(d, today))}
            </button>
          ))}
        </div>
        <p className="text-sm text-stone-500">Changes this day only. Templates stay as they are.</p>
        {loaded && (
          <>
            <ul className="space-y-2">
              {blocks.length === 0 && <li className="text-sm text-stone-500">No blocks.</li>}
              {[...blocks]
                .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
                .map((b) => (
                  <BlockRow
                    key={b.id}
                    block={b}
                    dayBlocks={blocks}
                    tasks={tasks.filter((t) => t.blockId === b.id)}
                    areas={areas}
                    today={today}
                    now={now}
                  />
                ))}
            </ul>
            <AddBlock key={date} date={date} dayBlocks={blocks} areas={areas} now={now} areaId={areaId} onAdded={onAdded} />
          </>
        )}
        <button type="button" className={`${secondaryBtn} w-full`} onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  )
}

function Times({
  value,
  onChange,
}: {
  value: { start: string; end: string }
  onChange: (v: { start: string; end: string }) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-xs">
        Start
        <input type="time" className={input} value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        End
        <input type="time" className={input} value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} />
      </label>
    </div>
  )
}

function BlockRow({
  block,
  dayBlocks,
  tasks,
  areas,
  today,
  now,
}: {
  block: Block
  dayBlocks: Block[]
  tasks: Task[]
  areas: Area[]
  today: ISODate
  now: Date
}) {
  const [times, setTimes] = useState({ start: block.start, end: block.end })
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const dirty = times.start !== block.start || times.end !== block.end
  const problem = dirty ? blockEditProblem(times, dayBlocks, block.date, now, block.id) : null
  const need = tasks.reduce((sum, t) => sum + t.estimate, 0)
  const short = !problem && need > blockMinutes(times)
  const n = tasks.length
  const where = block.date <= today ? 'go to Unfinished' : 'go back to the brief'
  const areaName = areas.find((a) => a.id === block.areaId)?.name ?? 'Area'

  return (
    <li className="space-y-2 rounded-xl bg-stone-100 p-3">
      <p className="font-medium">
        {areaName}
        {block.protected && <span className="font-normal text-stone-500"> · Protected</span>}
        {n > 0 && <span className="font-normal text-stone-500"> · {n} task{n === 1 ? '' : 's'}</span>}
      </p>
      <Times
        value={times}
        onChange={(v) => {
          setTimes(v)
          setError(null)
        }}
      />
      {(problem ?? error) && <p className="text-xs text-red-700">{problem ?? error}</p>}
      {short && (
        <p className="text-xs text-stone-600">
          Tasks need {formatDuration(need)}; the block is {formatDuration(Math.max(0, blockMinutes(times)))}.
        </p>
      )}
      {confirming ? (
        <div className="rounded-lg bg-red-50 p-2">
          <p className="text-sm text-red-900">
            Delete this block?{n > 0 && ` ${n} task${n === 1 ? '' : 's'} will ${where}.`}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={`${secondaryBtn} flex-1`} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="h-11 flex-1 rounded-lg bg-red-700 px-4 font-medium text-white"
              onClick={() => deleteBlock(block.id)}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" className={dangerBtn} onClick={() => setConfirming(true)}>
            Delete
          </button>
          {dirty && (
            <>
              <button type="button" className={`${secondaryBtn} ml-auto`} onClick={() => setTimes({ start: block.start, end: block.end })}>
                Reset
              </button>
              <button
                type="button"
                className={primaryBtn}
                disabled={!!problem}
                onClick={async () => setError(await updateBlockTimes(block.id, times))}
              >
                Save
              </button>
            </>
          )}
        </div>
      )}
    </li>
  )
}

function AddBlock({
  date,
  dayBlocks,
  areas,
  now,
  areaId: preset,
  onAdded,
}: {
  date: ISODate
  dayBlocks: Block[]
  areas: Area[]
  now: Date
  areaId?: ID
  onAdded?: () => void
}) {
  const [areaId, setAreaId] = useState<ID>(preset ?? areas[0]?.id ?? '')
  const [times, setTimes] = useState({ start: '', end: '' })
  const [error, setError] = useState<string | null>(null)
  const touched = !!times.start || !!times.end
  const problem = touched ? blockEditProblem(times, dayBlocks, date, now) : null

  return (
    <fieldset className="space-y-2 rounded-xl border border-stone-200 p-3">
      <legend className="px-1 text-sm font-medium">Add block</legend>
      <label className="flex flex-col gap-1 text-xs">
        Area
        <select className={input} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <Times
        value={times}
        onChange={(v) => {
          setTimes(v)
          setError(null)
        }}
      />
      {(problem ?? error) && <p className="text-xs text-red-700">{problem ?? error}</p>}
      <button
        type="button"
        className={`${primaryBtn} w-full`}
        disabled={!touched || !!problem || !areaId}
        onClick={async () => {
          const result = await addBlock(date, { areaId, ...times })
          setError(result)
          if (result) return
          setTimes({ start: '', end: '' })
          onAdded?.()
        }}
      >
        Add block
      </button>
    </fieldset>
  )
}
