import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { blockRoom, scheduleNewTask } from '../db/blocks'
import { db, newId } from '../db/db'
import { addUrgent, isUrgent, type UrgentResult, undoUrgent } from '../db/replan'
import { addTask } from '../db/tasks'
import { isoDate } from '../lib/dates'
import { formatDuration } from '../lib/time'
import type { Block, ID, Task } from '../types'
import { showBanner } from '../lib/banners'
import { ScheduleForm } from './MoveSheet'
import { Sheet } from './Sheet'
import { dayLabel, emptyFields, type Fields, type Link, resolve, useRefs } from '../lib/task-fields'
import { TaskFields } from './TaskFields'
import { input, primaryBtn, secondaryBtn } from './ui'

export interface CaptureInit {
  text?: string
  link?: Link
  inboxId?: ID // turning an Inbox item into a task: it's removed in the same transaction as the save
  block?: Block // quick add into this (running) block: area preset, schedule fixed, may go over
}

// Quick capture. Fastest path: type, then To Inbox (or Enter) — no chips needed.
// Once any chip is set, Enter adds to the Backlog instead. The sheet stays open for the next task,
// except when processing an Inbox item, which closes it after the save.
// With init.block, it adds straight into that block (any area), even past its room.
// Urgent capture: a task due today (no block or schedule picked) goes into today's remaining blocks
// at once, moving lower-ranked tasks out if it must (db/replan). The result shows here with Undo;
// closing the sheet carries it to the app's banner for a few seconds.
export function Capture({ init, onClose }: { init?: CaptureInit; onClose: () => void }) {
  const refs = useRefs()
  const block = init?.block
  const [text, setText] = useState(init?.text ?? '')
  const [fields, setFields] = useState<Fields>(() => ({ ...emptyFields(init?.link ?? null), areaId: block?.areaId ?? null }))
  const inBlock = useLiveQuery(
    async () => (block ? await db.tasks.where('blockId').equals(block.id).filter((t) => t.status === 'scheduled').toArray() : []),
    [block?.id],
  )
  const [saves, setSaves] = useState(0) // remounts the chips (closing any open panel) after each save
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [today] = useState(() => isoDate(new Date()))
  const [urgent, setUrgent] = useState<{ text: string; undo: () => Promise<unknown> } | null>(null)
  const [unplaced, setUnplaced] = useState<Task | null>(null) // urgent, fit nowhere today: Pick a block
  const [placing, setPlacing] = useState<Task | null>(null)

  if (!refs || !inBlock) return null

  const close = () => {
    if (urgent) showBanner({ label: urgent.text, undo: urgent.undo }, 'replan')
    onClose()
  }

  if (placing)
    return (
      <Sheet title={placing.title} onClose={() => setPlacing(null)}>
        <ScheduleForm
          task={placing}
          onCancel={() => setPlacing(null)}
          onDone={(date) => {
            if (fromInbox) return onClose()
            setPlacing(null)
            setUnplaced(null)
            setStatus({ ok: true, text: `Scheduled ${dayLabel(date, today)}: ${placing.title}` })
          }}
        />
      </Sheet>
    )

  const fromInbox = !!init?.inboxId
  const { project, goal, estimate, areaId } = resolve(fields, refs)
  const { link, due, repeat, schedule } = fields
  const touched =
    !!block ||
    fromInbox || fields.estimate !== null || fields.areaId !== null || (link !== null && !init?.link) || !!due || !!repeat || !!schedule
  const scheduleIncomplete = !!schedule && !schedule.placement
  const title = text.trim()

  const saved = (message: string) => {
    setUrgent(null)
    setUnplaced(null)
    if (fromInbox) return onClose()
    setText('')
    setFields((f) => ({ ...emptyFields(f.link), areaId: f.areaId })) // keep area and goal/project for the next one
    setSaves((n) => n + 1)
    setStatus({ ok: true, text: message })
  }

  const toInbox = async () => {
    if (!title) return
    await db.inbox.add({ id: newId(), text: title, createdAt: nowISO() })
    saved(`To Inbox: ${title}`)
  }

  const addToBacklog = async () => {
    if (!title || !areaId || scheduleIncomplete) return
    const task: Task = {
      id: newId(),
      title,
      estimate,
      areaId,
      ...(goal && { goalId: goal.id }),
      ...(project && { projectId: project.id }),
      ...(due && { due }),
      ...(repeat && { repeat }),
      status: 'backlog',
      rollovers: 0,
      delegable: false,
      createdAt: nowISO(),
    }
    if (block) {
      const room = blockRoom(block, inBlock)
      if (!(await scheduleNewTask(task, block.date, { blockId: block.id }, { inboxId: init?.inboxId, force: true }))) {
        setStatus({ ok: false, text: 'This block is gone.' })
        return
      }
      const over = estimate - room
      saved(`Added: ${title}${over > 0 ? ` · ${over} min over` : ''}`)
    } else if (schedule?.placement) {
      const placed = await scheduleNewTask(task, schedule.date, schedule.placement, { inboxId: init?.inboxId })
      if (!placed) {
        setStatus({ ok: false, text: 'That block no longer has room. Pick again.' })
        setFields((f) => ({ ...f, schedule: { date: schedule.date, placement: null } }))
        return
      }
      saved(`Scheduled ${dayLabel(schedule.date, today)}: ${title}`)
    } else if (isUrgent(task)) {
      const result = await addUrgent(task, { inboxId: init?.inboxId })
      const area = refs.areas.find((a) => a.id === areaId)?.name ?? ''
      if (!result.placed) {
        const why = `Not placed: no ${project?.manualOnly ? '' : `${area} `}block left today${
          result.why === 'no-room' ? ` with ${formatDuration(estimate)} free` : ''
        }. In the Backlog, due today.`
        // From the Inbox the sheet stays open on this, so Pick a block is still there
        if (fromInbox) setStatus({ ok: true, text: why })
        else saved(why)
        setUnplaced(task)
        return
      }
      const text = await urgentText(title, result)
      const undo = () => undoUrgent(result.snapshot)
      if (fromInbox) {
        showBanner({ label: text, undo }, 'replan')
        return saved(text)
      }
      saved(text)
      setStatus(null)
      setUrgent({
        text,
        undo: async () => {
          const skipped = await undoUrgent(result.snapshot)
          setUrgent(null)
          setStatus({ ok: true, text: skipped.length ? `Undone, except ${skipped.join(', ')} (changed since)` : 'Undone' })
        },
      })
    } else {
      await addTask(task, { inboxId: init?.inboxId })
      saved(`To Backlog: ${title}`)
    }
  }

  return (
    <Sheet title={block ? 'Add to this block' : fromInbox ? 'Inbox item → task' : 'Capture'} onClose={close}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (fromInbox && unplaced) return // already saved: Pick a block or Close
          if (touched) addToBacklog()
          else toInbox()
        }}
      >
        <label htmlFor="capture-text" className="sr-only">
          Task
        </label>
        <input
          id="capture-text"
          autoFocus
          autoComplete="off"
          enterKeyHint="done"
          className={`${input} w-full`}
          placeholder="What needs doing?"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setStatus(null)
          }}
        />

        {block && <BlockLine block={block} room={blockRoom(block, inBlock)} estimate={estimate} area={refs.areas} />}
        <TaskFields key={saves} fields={fields} onChange={setFields} refs={refs} today={today} noSchedule={!!block} />

        {status && (
          <p role="status" className={`text-sm ${status.ok ? 'text-stone-500' : 'text-red-700'}`}>
            {status.text}
          </p>
        )}
        {unplaced && (
          <button type="button" className={`${secondaryBtn} w-full`} onClick={() => setPlacing(unplaced)}>
            Pick a block
          </button>
        )}
        {urgent && (
          <div role="status" className="flex items-center gap-2 rounded-xl bg-stone-100 py-1 pl-3 pr-1">
            <p className="min-w-0 flex-1 py-1 text-sm">{urgent.text}</p>
            <button type="button" className="h-11 shrink-0 rounded-lg px-3 font-medium active:bg-stone-200" onClick={urgent.undo}>
              Undo
            </button>
          </div>
        )}

        {fromInbox && unplaced ? (
          <button type="button" className={`${secondaryBtn} w-full`} onClick={close}>
            Close
          </button>
        ) : (
          <div className="flex gap-2 pt-1">
            {!fromInbox && (
              <button
                type="button"
                className={`${touched ? secondaryBtn : primaryBtn} flex-1`}
                disabled={!title}
                onClick={toInbox}
              >
                To Inbox
              </button>
            )}
            <button
              type="button"
              className={`${touched ? primaryBtn : secondaryBtn} flex-1`}
              disabled={!title || scheduleIncomplete}
              onClick={addToBacklog}
            >
              {block ? 'Add to block' : schedule ? 'Schedule' : 'Add to Backlog'}
            </button>
          </div>
        )}
      </form>
    </Sheet>
  )
}

const nowISO = () => new Date().toISOString()

// "Due today: Call bank → Work 14:00 · moved Draft memo → 16:00", or with several moved
// "· moved 2: Draft memo → 16:00, Tidy inbox → Backlog".
async function urgentText(title: string, result: Extract<UrgentResult, { placed: true }>) {
  const ids = [result.blockId, ...result.moves.flatMap((m) => (m.to ? [m.to] : []))]
  const blocks = new Map((await db.blocks.bulkGet(ids)).flatMap((b) => (b ? [[b.id, b] as const] : [])))
  const area = await db.areas.get(blocks.get(result.blockId)?.areaId ?? '')
  const at = `${area?.name ?? 'block'} ${blocks.get(result.blockId)?.start ?? ''}`.trim()
  const moves = result.moves.map((m) => `${m.task.title} → ${m.to ? (blocks.get(m.to)?.start ?? 'later') : 'Backlog'}`)
  const moved = moves.length === 1 ? ` · moved ${moves[0]}` : moves.length ? ` · moved ${moves.length}: ${moves.join(', ')}` : ''
  return `Due today: ${title} → ${at}${moved}`
}

// Where a quick add goes, and whether it fits: "45m free" or "15 min over".
function BlockLine({ block, room, estimate, area }: { block: Block; room: number; estimate: number; area: { id: ID; name: string }[] }) {
  const over = estimate - room
  return (
    <p className="text-sm text-stone-500">
      Into {area.find((a) => a.id === block.areaId)?.name ?? 'block'} {block.start}–{block.end} ·{' '}
      {over > 0 ? <span className="text-stone-900">{over} min over</span> : `${formatDuration(room - estimate)} free after`}
    </p>
  )
}
