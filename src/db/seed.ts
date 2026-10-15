import { type BriefDB, db as defaultDb, SETTINGS_KEY } from './db'
import { buildSeed } from './seed-data'

// Wipes every table and writes the seed. Safe to run any number of times.
export async function seed(db: BriefDB = defaultDb, today = new Date()) {
  const data = buildSeed(today)
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await db.settings.put(data.settings, SETTINGS_KEY)
    await db.areas.bulkPut(data.areas)
    await db.blockTemplates.bulkPut(data.blockTemplates)
    await db.goals.bulkPut(data.goals)
    await db.projects.bulkPut(data.projects)
    await db.tasks.bulkPut(data.tasks)
  })
}

// First launch: seed an empty database.
export async function ensureSeeded(db: BriefDB = defaultDb) {
  if ((await db.settings.count()) === 0) await seed(db)
}
