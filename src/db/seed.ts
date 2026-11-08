import { type BriefDB, db as defaultDb, SEED_KEY, SETTINGS_KEY } from './db'
import { buildSeed } from './seed-data'

// Which seed the device's data started from. A device on an older one is reset once to the current
// seed when this version first opens (the owner keeps no pre-M7 data). Bump it to force another reset.
export const SEED_VERSION = 'm7'

// Wipes every table and writes the seed. Safe to run any number of times.
export async function seed(db: BriefDB = defaultDb, today = new Date()) {
  const data = buildSeed(today)
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await db.meta.put(SEED_VERSION, SEED_KEY)
    await db.settings.put(data.settings, SETTINGS_KEY)
    await db.areas.bulkPut(data.areas)
    await db.blockTemplates.bulkPut(data.blockTemplates)
    await db.goals.bulkPut(data.goals)
    await db.projects.bulkPut(data.projects)
    await db.tasks.bulkPut(data.tasks)
  })
}

// First launch, or the first launch of a version with a new SEED_VERSION: replace everything with the seed.
export async function ensureSeeded(db: BriefDB = defaultDb) {
  if ((await db.settings.count()) === 0 || (await db.meta.get(SEED_KEY)) !== SEED_VERSION) await seed(db)
}
