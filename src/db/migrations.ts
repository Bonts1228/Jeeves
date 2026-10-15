// Row migrations, shared by the Dexie upgrades (db.ts) and by importing an older export file
// (backup.ts), so an old phone database and an old file take the same path.

// The Dexie schema version. Exports carry it; bump it with every db.version().
export const SCHEMA_VERSION = 3

type Row = Record<string, unknown>

// v2: recurringBlockId replaced by servedByBlocks (set by hand: the old single block can't say which area)
export function goalToV2(goal: Row) {
  delete goal.recurringBlockId
}

// Upgrade exported tables in place from fromVersion to SCHEMA_VERSION.
// v3 only added the meta table, which exports don't carry.
export function migrateTables(tables: Record<string, Row[]>, fromVersion: number) {
  if (fromVersion < 2) tables.goals.forEach(goalToV2)
}
