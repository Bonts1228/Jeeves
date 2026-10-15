import type { Block, Goal, LogEntry } from '../types'

// The recurring goal a block serves (every block in its area counts once), if any.
export function servedGoal(block: Block, goals: Goal[]): Goal | undefined {
  return goals.find((g) => g.type === 'recurring' && g.servedByBlocks && g.areaId === block.areaId)
}

export const blockTicked = (block: Block, logs: LogEntry[]) => logs.some((l) => l.blockId === block.id)
