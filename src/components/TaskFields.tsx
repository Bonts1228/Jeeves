import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { type BlockWithRoom, blocksWithRoom, oneOffProblem } from '../db/blocks'
import { db } from '../db/db'
import { addDays, nextWeekday, weekdayOf } from '../lib/dates'
import {
  capitalise,
  dayLabel,
  type Fields,
  type Link,
  type Refs,
  repeatLabel,
  resolve,
  type ScheduleDraft,
} from '../lib/task-fields'
import { formatDuration, fromMinutes, minutesOfDay, toMinutes, WEEKDAY_SHORT, WEEKDAYS_MON_FIRST } from '../lib/time'
import type { Area, Block, Goal, ID, ISODate, Project, Repeat, Task } from '../types'
import { input } from './ui'

// The task chips shared by Capture and task edit: estimate, area, goal/project, due, repeat, schedule.

const ESTIMATES = [15, 30, 45, 60, 90, 120]
type ChipName = 'estimate' | 'area' | 'link' | 'due' | 'repeat' | 'schedule'

// Scheduling is offered for manual-only project tasks (any area) and already-scheduled tasks (own area).
export function TaskFields({
  fields,
  onChange,
  refs,
  today,
  task,
}: {
  fields: Fields
  onChange: (f: Fields) => void
  refs: Refs
  today: ISODate
  task?: Task
}) {
  const [open, setOpen] = useState<ChipName | null>(null)
  const { areas, goals, projects } = refs
  const { estimate, areaId, link, due, repeat, schedule } = fields
  const r = resolve(fields, refs)
  const anyArea = !!r.project?.manualOnly
  const canSchedule = anyArea || task?.status === 'scheduled'
  const scheduleIncomplete = !!schedule && !schedule.placement

  const set = (patch: Partial<Fields>) => onChange({ ...fields, ...patch })
  const toggle = (chip: ChipName) => setOpen((o) => (o === chip ? null : chip))

  const changeLink = (next: Link) => {
    const p = next && 'projectId' in next ? projects.find((x) => x.id === next.projectId) : undefined
    set({ link: next, ...(!p?.manualOnly && task?.status !== 'scheduled' && { schedule: null }) })
  }

  // Repeats need a due date: default to the first occurrence
  const changeRepeat = (next: Repeat | undefined) => {
    const first = next?.kind === 'weekly' && weekdayOf(today) !== next.weekday ? nextWeekday(today, next.weekday) : today
    set({ repeat: next, ...(next && !due && { due: first }) })
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Chip name="estimate" open={open} set={estimate !== null} onToggle={toggle}>
          {formatDuration(r.estimate)}
        </Chip>
        <Chip name="area" open={open} set={areaId !== null} onToggle={toggle}>
          {areas.find((a) => a.id === r.areaId)?.name ?? 'Area'}
        </Chip>
        <Chip name="link" open={open} set={link !== null} onToggle={toggle}>
          {r.project?.title ?? r.goal?.title ?? 'Goal / project'}
        </Chip>
        <Chip name="due" open={open} set={!!due} onToggle={toggle}>
          {due ? `Due ${dayLabel(due, today)}` : 'Due'}
        </Chip>
        <Chip name="repeat" open={open} set={!!repeat} onToggle={toggle}>
          {repeat ? repeatLabel(repeat) : 'Repeat'}
        </Chip>
        {canSchedule && (
          <Chip name="schedule" open={open} set={!!schedule} onToggle={toggle}>
            {schedule ? `${capitalise(dayLabel(schedule.date, today))}${scheduleIncomplete ? '…' : ''}` : 'Schedule'}
          </Chip>
        )}
      </div>

      {open === 'estimate' && (
        <Options label="Estimate">
          {ESTIMATES.map((m) => (
            <Option key={m} pressed={estimate === m} onClick={() => set({ estimate: m })}>
              {formatDuration(m)}
            </Option>
          ))}
        </Options>
      )}
      {open === 'area' && (
        <Options label="Area">
          {areas.map((a) => (
            <Option key={a.id} pressed={areaId === a.id} onClick={() => set({ areaId: a.id })}>
              {a.name}
            </Option>
          ))}
        </Options>
      )}
      {open === 'link' && <LinkPicker goals={goals} projects={projects} link={link} onChange={changeLink} />}
      {open === 'due' && (
        <Options label="Due">
          <Option pressed={due === today} onClick={() => set({ due: today })}>
            Today
          </Option>
          <Option pressed={due === addDays(today, 1)} onClick={() => set({ due: addDays(today, 1) })}>
            Tomorrow
          </Option>
          <label className="flex items-center gap-2">
            <span className="sr-only">Due date</span>
            <input
              type="date"
              className={input}
              value={due ?? ''}
              onChange={(e) => set({ due: e.target.value || undefined })}
            />
          </label>
          {due && (
            <Option pressed={false} onClick={() => set({ due: undefined, repeat: undefined })}>
              {repeat ? 'Clear (ends repeat)' : 'Clear'}
            </Option>
          )}
        </Options>
      )}
      {open === 'repeat' && <RepeatPicker repeat={repeat} onChange={changeRepeat} />}
      {open === 'schedule' && canSchedule && r.areaId && (
        <SchedulePicker
          schedule={schedule}
          estimate={r.estimate}
          areaId={r.areaId}
          anyArea={anyArea}
          areas={areas}
          today={today}
          task={task}
          onChange={(s) => set({ schedule: s })}
        />
      )}
    </>
  )
}

function Chip({
  name,
  open,
  set,
  onToggle,
  children,
}: {
  name: ChipName
  open: ChipName | null
  set: boolean
  onToggle: (name: ChipName) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-expanded={open === name}
      onClick={() => onToggle(name)}
      className={`h-11 max-w-full truncate rounded-full border px-4 text-sm font-medium ${
        set ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-600'
      } ${open === name ? 'ring-2 ring-stone-400 ring-offset-1' : ''}`}
    >
      {children}
    </button>
  )
}

function Options({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2 rounded-xl bg-stone-100 p-2">
      {children}
    </div>
  )
}

function Option({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`h-11 rounded-lg px-3 text-sm font-medium ${pressed ? 'bg-stone-900 text-white' : 'bg-white text-stone-700'}`}
    >
      {children}
    </button>
  )
}

function LinkPicker({
  goals,
  projects,
  link,
  onChange,
}: {
  goals: Goal[]
  projects: Project[]
  link: Link
  onChange: (link: Link) => void
}) {
  const value = !link ? '' : 'goalId' in link ? `goal:${link.goalId}` : `project:${link.projectId}`
  return (
    <label className="flex flex-col gap-1 rounded-xl bg-stone-100 p-2">
      <span className="text-sm font-medium text-stone-600">Goal or project</span>
      <select
        className={input}
        value={value}
        onChange={(e) => {
          const [kind, id] = e.target.value.split(':')
          onChange(!id ? null : kind === 'goal' ? { goalId: id } : { projectId: id })
        }}
      >
        <option value="">None</option>
        <optgroup label="Goals">
          {goals.map((g) => (
            <option key={g.id} value={`goal:${g.id}`}>
              {g.title}
            </option>
          ))}
        </optgroup>
        <optgroup label="Projects">
          {projects.map((p) => (
            <option key={p.id} value={`project:${p.id}`}>
              {p.title}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  )
}

function RepeatPicker({ repeat, onChange }: { repeat?: Repeat; onChange: (r: Repeat | undefined) => void }) {
  const [days, setDays] = useState(repeat?.kind === 'every' ? repeat.days : 7)
  return (
    <div className="space-y-2 rounded-xl bg-stone-100 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Option pressed={!repeat} onClick={() => onChange(undefined)}>
          None
        </Option>
        <Option pressed={repeat?.kind === 'every'} onClick={() => onChange({ kind: 'every', days })}>
          Every
        </Option>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Number of days</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            className={`${input} w-20`}
            value={days}
            onChange={(e) => {
              const n = Math.max(1, Math.round(Number(e.target.value) || 1))
              setDays(n)
              onChange({ kind: 'every', days: n })
            }}
          />
          days
        </label>
      </div>
      <div role="group" aria-label="Weekly on" className="grid grid-cols-7 gap-1">
        {WEEKDAYS_MON_FIRST.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={repeat?.kind === 'weekly' && repeat.weekday === d}
            onClick={() => onChange({ kind: 'weekly', weekday: d })}
            className={`h-11 rounded-lg text-xs font-medium ${
              repeat?.kind === 'weekly' && repeat.weekday === d ? 'bg-stone-900 text-white' : 'bg-white text-stone-600'
            }`}
          >
            {WEEKDAY_SHORT[d]}
          </button>
        ))}
      </div>
      <p className="px-1 text-xs text-stone-500">Every N days counts from when it's done. Weekly picks a day.</p>
    </div>
  )
}

// Pick a day, then a block with room or a new one-off block. Only free room is offered: nothing
// already scheduled moves. A chosen block that stops fitting is dropped with a prompt to pick again.
function SchedulePicker({
  schedule,
  estimate,
  areaId,
  anyArea,
  areas,
  today,
  task,
  onChange,
}: {
  schedule: ScheduleDraft | null
  estimate: number
  areaId: ID
  anyArea: boolean
  areas: Area[]
  today: ISODate
  task?: Task
  onChange: (s: ScheduleDraft | null) => void
}) {
  const date = schedule?.date ?? today
  const current = task?.status === 'scheduled' ? task : undefined
  const dates = [...new Set([today, addDays(today, 1), ...(current?.date ? [current.date] : [])])].sort()
  const [options, setOptions] = useState<BlockWithRoom[] | null>(null)
  const [dayBlocks, setDayBlocks] = useState<Block[]>([])
  const [newBlock, setNewBlock] = useState({ start: '', end: '' })
  const [edited, setEdited] = useState(false)
  const [dropped, setDropped] = useState<string | null>(null)
  const placement = schedule?.placement
  const newSelected = !!placement && 'newBlock' in placement

  // Re-read room whenever the day's tasks or blocks change
  const version = useLiveQuery(
    async () => `${await db.tasks.where('date').equals(date).count()}:${await db.blocks.where('date').equals(date).count()}`,
    [date],
  )
  const latest = useRef({ placement, onChange })
  useEffect(() => {
    latest.current = { placement, onChange }
  })

  // Read room for the day. A chosen block that stopped fitting (bigger estimate, area change, the day
  // filled up) is dropped with a prompt to pick again: never overfill.
  useEffect(() => {
    let live = true
    blocksWithRoom(date, estimate, { areaId: anyArea ? undefined : areaId, excludeTaskId: task?.id }).then(
      async (list) => {
        const blocks = await db.blocks.where('date').equals(date).toArray()
        if (!live) return
        setOptions(list)
        setDayBlocks(blocks)
        if (!edited) setNewBlock(suggestBlock(date, today, estimate, blocks))
        const chosen = latest.current.placement
        if (chosen && 'blockId' in chosen && !list.some((o) => o.block.id === chosen.blockId)) {
          const block = blocks.find((b) => b.id === chosen.blockId)
          if (block) setDropped(`${formatDuration(estimate)} no longer fits in ${block.start}–${block.end}. Pick again.`)
          latest.current.onChange({ date, placement: null })
        }
      },
    )
    return () => {
      live = false
    }
  }, [date, estimate, version, edited, today, anyArea, areaId, task?.id])

  const problem = oneOffProblem(newBlock, estimate, dayBlocks, date)
  const pickDate = (d: ISODate) => {
    setEdited(false)
    setDropped(null)
    onChange({ date: d, placement: null })
  }
  const setNew = (patch: Partial<typeof newBlock>) => {
    const next = { ...newBlock, ...patch }
    if (Object.keys(patch).length) setEdited(true)
    setNewBlock(next)
    setDropped(null)
    onChange({ date, placement: oneOffProblem(next, estimate, dayBlocks, date) ? null : { newBlock: { ...next, areaId } } })
  }
  const areaName = (id: ID) => areas.find((a) => a.id === id)?.name ?? 'Area'

  return (
    <div className="space-y-2 rounded-xl bg-stone-100 p-2">
      <div className="flex gap-2">
        {dates.map((d) => (
          <Option key={d} pressed={!!schedule && date === d} onClick={() => pickDate(d)}>
            {capitalise(dayLabel(d, today))}
          </Option>
        ))}
        {schedule && (
          <button type="button" className="ml-auto h-11 px-3 text-sm text-stone-600" onClick={() => onChange(null)}>
            {current ? 'Back to Backlog' : "Don't schedule"}
          </button>
        )}
      </div>
      {dropped && !placement && (
        <p role="alert" className="px-1 text-sm text-red-700">
          {dropped}
        </p>
      )}

      {schedule && (
        <>
          <ul className="space-y-1" aria-label="Blocks with room">
            {options?.length === 0 && (
              <li className="px-1 text-sm text-stone-500">
                No {anyArea ? '' : `${areaName(areaId)} `}block has {formatDuration(estimate)} free. Make a new one.
              </li>
            )}
            {options?.map(({ block, room }) => {
              const selected = !!placement && 'blockId' in placement && placement.blockId === block.id
              return (
                <li key={block.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setDropped(null)
                      onChange({ date, placement: { blockId: block.id } })
                    }}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm ${
                      selected ? 'bg-stone-900 text-white' : 'bg-white'
                    }`}
                  >
                    <span className="tabular-nums">
                      {block.start}–{block.end}
                    </span>
                    <span className="flex-1 font-medium">{areaName(block.areaId)}</span>
                    <span className={selected ? 'text-stone-300' : 'text-stone-500'}>
                      {block.id === current?.blockId && 'Current · '}
                      {formatDuration(room)} free
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <fieldset
            className={`rounded-lg p-2 ${newSelected ? 'bg-stone-900 text-white' : 'bg-white'}`}
            onFocus={() => !problem && setNew({})}
            onClick={() => !problem && setNew({})}
          >
            <legend className="sr-only">New block</legend>
            <p className="mb-1 text-sm font-medium">New block · {areaName(areaId)}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs">
                Start
                <input
                  type="time"
                  className={`${input} text-stone-900`}
                  value={newBlock.start}
                  onChange={(e) => setNew({ start: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                End
                <input
                  type="time"
                  className={`${input} text-stone-900`}
                  value={newBlock.end}
                  onChange={(e) => setNew({ end: e.target.value })}
                />
              </label>
            </div>
            {problem && <p className="mt-1 text-xs text-red-700">{problem}</p>}
          </fieldset>
        </>
      )}
    </div>
  )
}

// A new block suggestion: the first gap that fits the estimate, from 09:00 (or the next half hour today).
function suggestBlock(date: ISODate, today: ISODate, estimate: number, dayBlocks: Block[]) {
  let start = date === today ? Math.ceil((minutesOfDay(new Date()) + 1) / 30) * 30 : 9 * 60
  for (const b of [...dayBlocks].sort((x, y) => toMinutes(x.start) - toMinutes(y.start)))
    if (toMinutes(b.start) < start + estimate && start < toMinutes(b.end)) start = toMinutes(b.end)
  start = Math.min(start, 24 * 60 - 1 - estimate)
  return { start: fromMinutes(start), end: fromMinutes(start + estimate) }
}
