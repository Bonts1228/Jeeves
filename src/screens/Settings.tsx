import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { BackIcon } from '../components/icons'
import { Sheet } from '../components/Sheet'
import { dangerBtn, input, primaryBtn, secondaryBtn } from '../components/ui'
import { db, newId, SETTINGS_KEY } from '../db/db'
import {
  exportData,
  exportFileName,
  type ImportSummary,
  importData,
  lastExport,
  markExported,
  type ParsedImport,
  parseImport,
} from '../db/backup'
import { SCHEMA_VERSION } from '../db/migrations'
import { seed } from '../db/seed'
import {
  blockMinutes,
  formatDuration,
  overlaps,
  toMinutes,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  WEEKDAYS_MON_FIRST,
} from '../lib/time'
import type { Area, BlockTemplate, Settings as SettingsRow, Weekday } from '../types'


export function Settings() {
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_KEY))
  const areas = useLiveQuery(() => db.areas.toArray())
  const templates = useLiveQuery(() => db.blockTemplates.toArray())

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 flex items-center gap-1 bg-stone-50/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
        <Link
          to="/"
          aria-label="Back"
          className="flex h-11 w-11 items-center justify-center rounded-full text-stone-600 active:bg-stone-200"
        >
          <BackIcon />
        </Link>
        <h1 className="py-3 text-2xl font-semibold">Settings</h1>
      </header>
      <main className="space-y-8 px-4 pt-2">
        {settings && templates && (
          <>
            <BriefTime settings={settings} />
            <Capacity settings={settings} templates={templates} />
          </>
        )}
        {areas && <Areas areas={areas} />}
        {areas && templates && <Templates areas={areas} templates={templates} />}
        <Backup />
        <ResetSeed />
        <p className="text-center text-xs text-stone-400">
          Build {new Date(__BUILD_TIME__).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </p>
      </main>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <p className="mb-3 text-sm text-stone-500">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  )
}

function BriefTime({ settings }: { settings: SettingsRow }) {
  return (
    <Section title="Brief time" hint="When tomorrow's brief is built.">
      <label className="flex items-center justify-between rounded-xl bg-white px-4 py-2">
        <span>Build brief at</span>
        <input
          type="time"
          className={input}
          value={settings.briefTime}
          onChange={(e) => e.target.value && db.settings.update(SETTINGS_KEY, { briefTime: e.target.value })}
        />
      </label>
    </Section>
  )
}

// 0h to 16h in half-hour steps
const CAPACITY_OPTIONS = Array.from({ length: 33 }, (_, i) => i * 30)

function Capacity({ settings, templates }: { settings: SettingsRow; templates: BlockTemplate[] }) {
  const setCapacity = (day: Weekday, mins: number) =>
    db.settings.put({ ...settings, capacity: { ...settings.capacity, [day]: mins } }, SETTINGS_KEY)

  return (
    <Section title="Capacity" hint="Hours you have for tasks each day. Brief fills to the lower of this and block time.">
      <ul className="divide-y divide-stone-100 rounded-xl bg-white">
        {WEEKDAYS_MON_FIRST.map((day) => {
          const blockTime = templates
            .filter((t) => t.weekday === day && !t.protected)
            .reduce((sum, t) => sum + blockMinutes(t), 0)
          const value = settings.capacity[day]
          const options = CAPACITY_OPTIONS.includes(value) ? CAPACITY_OPTIONS : [...CAPACITY_OPTIONS, value].sort((a, b) => a - b)
          return (
            <li key={day} className="flex items-center gap-3 px-4 py-2">
              <label htmlFor={`cap-${day}`} className="w-12 font-medium">
                {WEEKDAY_SHORT[day]}
              </label>
              <select
                id={`cap-${day}`}
                className={`${input} w-28`}
                value={value}
                onChange={(e) => setCapacity(day, Number(e.target.value))}
              >
                {options.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? 'None' : formatDuration(m)}
                  </option>
                ))}
              </select>
              <span className="ml-auto text-sm text-stone-500">{formatDuration(blockTime)} in blocks</span>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function Areas({ areas }: { areas: Area[] }) {
  const [name, setName] = useState('')
  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    await db.areas.add({ id: newId(), name: trimmed })
    setName('')
  }

  return (
    <Section title="Areas">
      <ul className="divide-y divide-stone-100 rounded-xl bg-white">
        {areas.map((a) => (
          <AreaRow key={`${a.id}:${a.name}`} area={a} />
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <label htmlFor="new-area" className="sr-only">
          New area name
        </label>
        <input
          id="new-area"
          className={`${input} min-w-0 flex-1`}
          placeholder="New area"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className={primaryBtn} disabled={!name.trim()}>
          Add
        </button>
      </form>
    </Section>
  )
}

function AreaRow({ area }: { area: Area }) {
  const [name, setName] = useState(area.name)
  const [blocked, setBlocked] = useState<string | null>(null)

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) setName(area.name)
    else if (trimmed !== area.name) db.areas.update(area.id, { name: trimmed })
  }

  const remove = async () => {
    const [templates, tasks, goals] = await Promise.all([
      db.blockTemplates.where('areaId').equals(area.id).count(),
      db.tasks.where('areaId').equals(area.id).count(),
      db.goals.where('areaId').equals(area.id).count(),
    ])
    const uses = [
      [templates, 'block'],
      [tasks, 'task'],
      [goals, 'goal'],
    ]
      .filter(([n]) => n)
      .map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`)
    if (uses.length) setBlocked(`Used by ${uses.join(', ')}. Move or delete those first.`)
    else await db.areas.delete(area.id)
  }

  return (
    <li className="px-4 py-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`area-${area.id}`} className="sr-only">
          Area name
        </label>
        <input
          id={`area-${area.id}`}
          className={`${input} min-w-0 flex-1 border-transparent px-0 focus:border-stone-300 focus:px-3`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button type="button" className={dangerBtn} onClick={remove}>
          Delete
        </button>
      </div>
      {blocked && (
        <p role="alert" className="pb-1 text-sm text-red-700">
          {blocked}
        </p>
      )}
    </li>
  )
}

type Draft = Omit<BlockTemplate, 'id'> & { id?: string }

function Templates({ areas, templates }: { areas: Area[]; templates: BlockTemplate[] }) {
  const [day, setDay] = useState<Weekday>(() => new Date().getDay() as Weekday)
  const [draft, setDraft] = useState<Draft | null>(null)
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? 'Unknown area'

  const dayTemplates = templates
    .filter((t) => t.weekday === day)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))

  return (
    <Section title="Block templates" hint="Your usual week. Protected blocks never get tasks.">
      <div role="group" aria-label="Weekday" className="mb-3 grid grid-cols-7 gap-1">
        {WEEKDAYS_MON_FIRST.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === day}
            onClick={() => setDay(d)}
            className={`h-11 rounded-lg text-sm font-medium ${
              d === day ? 'bg-stone-900 text-white' : 'bg-white text-stone-600'
            }`}
          >
            {WEEKDAY_SHORT[d]}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-stone-100 rounded-xl bg-white">
        {dayTemplates.length === 0 && <li className="px-4 py-3 text-stone-500">No blocks on {WEEKDAY_LONG[day]}.</li>}
        {dayTemplates.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setDraft(t)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-stone-50"
            >
              <span className="w-28 shrink-0 tabular-nums text-stone-600">
                {t.start}–{t.end}
              </span>
              <span className="flex-1 font-medium">{areaName(t.areaId)}</span>
              {t.protected && (
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">Protected</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={`${secondaryBtn} mt-3 w-full`}
        disabled={areas.length === 0}
        onClick={() => {
          const last = dayTemplates.at(-1)
          setDraft({ weekday: day, areaId: areas[0].id, start: last?.end ?? '09:00', end: '', protected: false })
        }}
      >
        + Add block to {WEEKDAY_LONG[day]}
      </button>

      {draft && (
        <TemplateSheet
          draft={draft}
          areas={areas}
          siblings={templates.filter((t) => t.weekday === draft.weekday && t.id !== draft.id)}
          onClose={() => setDraft(null)}
        />
      )}
    </Section>
  )
}

function TemplateSheet({
  draft: initial,
  areas,
  siblings,
  onClose,
}: {
  draft: Draft
  areas: Area[]
  siblings: BlockTemplate[]
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const valid = draft.start && draft.end && toMinutes(draft.end) > toMinutes(draft.start)
  const clash = valid ? siblings.find((s) => overlaps(s, draft)) : undefined

  const save = async () => {
    if (!valid) return
    await db.blockTemplates.put({ ...draft, id: draft.id ?? newId() })
    onClose()
  }
  const remove = async () => {
    if (draft.id) await db.blockTemplates.delete(draft.id)
    onClose()
  }

  return (
    <Sheet title={`${draft.id ? 'Edit' : 'New'} block · ${WEEKDAY_LONG[draft.weekday]}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-stone-600">Area</span>
          <select className={input} value={draft.areaId} onChange={(e) => set({ areaId: e.target.value })}>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-stone-600">Start</span>
            <input type="time" className={input} value={draft.start} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-stone-600">End</span>
            <input type="time" className={input} value={draft.end} onChange={(e) => set({ end: e.target.value })} />
          </label>
        </div>
        {draft.start && draft.end && !valid && <p className="text-sm text-red-700">End must be after start.</p>}
        {clash && (
          <p className="text-sm text-amber-700">
            Overlaps {clash.start}–{clash.end}. You can still save.
          </p>
        )}
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 accent-stone-900"
            checked={draft.protected}
            onChange={(e) => set({ protected: e.target.checked })}
          />
          <span>
            Protected <span className="text-sm text-stone-500">(no tasks placed)</span>
          </span>
        </label>
        <div className="flex gap-2 pt-2">
          {draft.id && (
            <button type="button" className={dangerBtn} onClick={remove}>
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
    </Sheet>
  )
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

interface Prepared {
  file: File
  exportedAt: string
}

// Export to one JSON file (share sheet on iPhone: Save to Files), import one back.
function Backup() {
  const last = useLiveQuery(async () => (await lastExport()) ?? null)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [toImport, setToImport] = useState<Extract<ParsedImport, { ok: true }> | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  // Share sheet where files can be shared (iPhone), else a download. Only a completed share counts.
  const deliver = async ({ file, exportedAt }: Prepared) => {
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
      } catch (e) {
        const name = (e as Error).name
        if (name === 'NotAllowedError') setPrepared({ file, exportedAt }) // the tap expired while preparing: one more tap
        else if (name !== 'AbortError') setMessage({ ok: false, text: `Export failed: ${(e as Error).message}` })
        return
      }
    } else {
      const url = URL.createObjectURL(file)
      const a = Object.assign(document.createElement('a'), { href: url, download: file.name })
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }
    setPrepared(null)
    await markExported(exportedAt)
    setMessage({ ok: true, text: `Exported ${file.name}.` })
  }

  const exportNow = async () => {
    setMessage(null)
    const data = await exportData()
    const file = new File([JSON.stringify(data, null, 2)], exportFileName(), { type: 'application/json' })
    await deliver({ file, exportedAt: data.exportedAt })
  }

  const pick = async (file: File | undefined) => {
    setMessage(null)
    setToImport(null)
    if (!file) return
    const parsed = parseImport(await file.text())
    if (parsed.ok) setToImport(parsed)
    else setMessage({ ok: false, text: `Can't import ${file.name}: ${parsed.reason} Nothing was changed.` })
  }

  const replace = async () => {
    if (!toImport) return
    try {
      await importData(toImport.file)
      setMessage({ ok: true, text: `Imported data from ${when(toImport.summary.exportedAt)}.` })
    } catch (e) {
      setMessage({ ok: false, text: `Import failed, nothing was changed: ${(e as Error).message}` })
    }
    setToImport(null)
  }

  return (
    <Section title="Backup" hint="Data lives only on this device. Export a copy now and then.">
      <p className="mb-3 text-sm">
        Last export: <span className="font-medium">{last === undefined ? '…' : last ? when(last) : 'Never'}</span>
      </p>
      {toImport ? (
        <ImportConfirm summary={toImport.summary} onCancel={() => setToImport(null)} onReplace={replace} />
      ) : (
        <div className="flex gap-2">
          {prepared ? (
            <button type="button" className={`${primaryBtn} flex-1`} onClick={() => deliver(prepared)}>
              Save export file
            </button>
          ) : (
            <button type="button" className={`${secondaryBtn} flex-1`} onClick={exportNow}>
              Export data
            </button>
          )}
          <label className={`${secondaryBtn} flex flex-1 cursor-pointer items-center justify-center focus-within:ring-2 focus-within:ring-stone-400`}>
            Import data
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                pick(e.target.files?.[0])
                e.target.value = '' // the same file can be picked again
              }}
            />
          </label>
        </div>
      )}
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${message.ok ? 'text-stone-500' : 'text-red-700'}`}>
          {message.text}
        </p>
      )}
    </Section>
  )
}

function ImportConfirm({
  summary,
  onCancel,
  onReplace,
}: {
  summary: ImportSummary
  onCancel: () => void
  onReplace: () => void
}) {
  const { exportedAt, tasks, goals, projects, fromVersion } = summary
  return (
    <div className="space-y-3 rounded-xl bg-red-50 p-3 text-red-900">
      <p className="text-sm">
        File from <span className="font-medium">{when(exportedAt)}</span>: {plural(tasks, 'task')}, {plural(goals, 'goal')},{' '}
        {plural(projects, 'project')}.
        {fromVersion < SCHEMA_VERSION && ' Made by an older version; it will be upgraded.'}
      </p>
      <p className="font-medium">This replaces everything on this device.</p>
      <div className="flex gap-2">
        <button type="button" className={`${secondaryBtn} flex-1`} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="h-11 flex-1 rounded-lg bg-red-700 px-4 font-medium text-white" onClick={onReplace}>
          Replace
        </button>
      </div>
    </div>
  )
}

function ResetSeed() {
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)

  return (
    <Section title="Seed data" hint="Replaces everything on this device with the seed week.">
      {confirming ? (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3">
          <span className="flex-1 text-sm text-red-800">All your changes will be lost.</span>
          <button type="button" className={secondaryBtn} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="h-11 rounded-lg bg-red-700 px-4 font-medium text-white"
            onClick={async () => {
              await seed()
              setConfirming(false)
              setDone(true)
            }}
          >
            Reset
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`${secondaryBtn} w-full`}
          onClick={() => {
            setDone(false)
            setConfirming(true)
          }}
        >
          Reset to seed data
        </button>
      )}
      {done && (
        <p role="status" className="mt-2 text-sm text-stone-500">
          Seed data restored.
        </p>
      )}
    </Section>
  )
}
