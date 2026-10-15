import { type Brief, buildBrief } from '../lib/brief'
import { isoDate } from '../lib/dates'
import type { ID, ISODate } from '../types'
import { ensureBlocks, type Placement } from './blocks'
import { type BriefDB, db as defaultDb, SETTINGS_KEY } from './db'
import { updateTask } from './tasks'

// A date's brief: built from the rules (lib/brief), reviewed, confirmed. Placements are saved on the
// tasks themselves; what's left about the brief lives in meta under brief:<date>, on this device only.

export interface BriefState {
  builtAt: string
  confirmedAt?: string
  removed: ID[] // taken out at review, so a refill doesn't put them back
}

const key = (date: ISODate) => `brief:${date}`

export async function briefState(date: ISODate, db: BriefDB = defaultDb): Promise<BriefState | undefined> {
  const raw = await db.meta.get(key(date))
  return raw ? JSON.parse(raw) : undefined
}

const saveState = (db: BriefDB, date: ISODate, state: BriefState) => db.meta.put(JSON.stringify(state), key(date))

// What the rules would do now, without writing. Read-only, so it can run in a live query; the date's
// blocks must already exist (ensureBlocks).
export async function readBrief(date: ISODate, { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {}) {
  const today = isoDate(now)
  const [settings, areas, goals, projects, tasks, logs, blocks, todayBlocks, state] = await Promise.all([
    db.settings.get(SETTINGS_KEY),
    db.areas.toArray(),
    db.goals.toArray(),
    db.projects.toArray(),
    db.tasks.where('status').anyOf('backlog', 'scheduled').toArray(),
    db.logEntries.toArray(),
    db.blocks.where('date').equals(date).toArray(),
    date > today ? db.blocks.where('date').equals(today).toArray() : [],
    briefState(date, db),
  ])
  if (!settings) throw new Error('No settings')
  return buildBrief({ date, now, settings, areas, goals, projects, tasks, logs, blocks, todayBlocks, removed: state?.removed })
}

// Fill the date's remaining room by the rules and save each placement (rule 5). Additive: what's
// already scheduled stays put, so running it again only adds what now fits. Overdue tasks moved
// onto the date count a rollover.
export async function fillBrief(
  date: ISODate,
  { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {},
): Promise<Brief> {
  await ensureBlocks(date, db)
  return db.transaction(
    'rw',
    [db.settings, db.areas, db.goals, db.projects, db.tasks, db.logEntries, db.blocks, db.meta],
    async () => {
      const brief = await readBrief(date, { now, db })
      for (const { task, blockId, reason, tier } of brief.placements)
        await db.tasks.update(task.id, {
          status: 'scheduled',
          date,
          blockId,
          reason,
          rollovers: task.rollovers + (tier === 1 ? 1 : 0),
        })
      const state = await briefState(date, db)
      await saveState(db, date, { removed: [], ...state, builtAt: now.toISOString() })
      return brief
    },
  )
}

// Take a task out of the brief: back to the Backlog, and kept out of refills for this date.
export async function removeFromBrief(date: ISODate, taskId: ID, db: BriefDB = defaultDb) {
  await updateTask(taskId, {}, null, { db })
  await db.transaction('rw', db.meta, async () => {
    const state = await briefState(date, db)
    const removed = [...new Set([...(state?.removed ?? []), taskId])]
    await saveState(db, date, { builtAt: new Date().toISOString(), ...state, removed })
  })
}

// Add a task yourself at review, into a block with room or a new one-off block. May go over capacity.
// Moving an overdue task counts a rollover. Returns false (nothing written) if it no longer fits.
export async function addToBrief(
  date: ISODate,
  taskId: ID,
  placement: Placement,
  { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {},
): Promise<boolean> {
  await ensureBlocks(date, db)
  return db.transaction('rw', [db.tasks, db.blocks, db.blockTemplates, db.goals, db.projects, db.meta], async () => {
    const before = await db.tasks.get(taskId)
    if (!before) return false
    const overdue = before.status === 'scheduled' && before.date! < date
    if ((await updateTask(taskId, {}, { date, placement }, { now, db })) !== 'ok') return false
    await db.tasks.update(taskId, { reason: 'Added by you', rollovers: before.rollovers + (overdue ? 1 : 0) })
    const state = await briefState(date, db)
    if (state?.removed.includes(taskId))
      await saveState(db, date, { ...state, removed: state.removed.filter((id) => id !== taskId) })
    return true
  })
}

export async function confirmBrief(date: ISODate, { now = new Date(), db = defaultDb }: { now?: Date; db?: BriefDB } = {}) {
  await db.transaction('rw', db.meta, async () => {
    const state = await briefState(date, db)
    await saveState(db, date, { builtAt: now.toISOString(), removed: [], ...state, confirmedAt: now.toISOString() })
  })
}
