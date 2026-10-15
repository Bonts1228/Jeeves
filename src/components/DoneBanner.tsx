import { useEffect, useState } from 'react'
import { tickBlock, untickBlock } from '../db/day'
import { completeTask, uncompleteTask } from '../db/tasks'
import type { Block, Goal, Task } from '../types'

const SHOW_MS = 6000

interface Shown {
  label: string
  undo: () => Promise<unknown>
}

// Ticking done (task or block goal), with an Undo banner for a few seconds after each tick.
// Undo later: tap the filled tick again.
export function useDone({ aboveBar = false }: { aboveBar?: boolean } = {}) {
  const [shown, setShown] = useState<Shown | null>(null)
  useEffect(() => {
    if (!shown) return
    const id = setTimeout(() => setShown(null), SHOW_MS)
    return () => clearTimeout(id)
  }, [shown])

  const toggleTask = async (task: Task) => {
    setShown(null)
    if (task.status === 'done') return uncompleteTask(task.id)
    await completeTask(task.id)
    setShown({ label: task.title, undo: () => uncompleteTask(task.id) })
  }

  const toggleBlock = async (block: Block, goal: Goal, ticked: boolean) => {
    setShown(null)
    if (ticked) return untickBlock(block.id)
    await tickBlock(block.id)
    setShown({ label: goal.title, undo: () => untickBlock(block.id) })
  }

  const banner = shown && (
    <div
      role="status"
      className={`fixed inset-x-0 z-20 mx-auto flex max-w-md px-4 ${
        aboveBar ? 'bottom-[calc(5rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(1rem+env(safe-area-inset-bottom))]'
      }`}
    >
      <div className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-stone-900 pl-4 pr-1 text-white shadow-lg">
        <p className="min-w-0 flex-1 truncate">✓ {shown.label}</p>
        <button
          type="button"
          className="h-11 rounded-lg px-4 font-medium active:bg-stone-700"
          onClick={async () => {
            setShown(null)
            await shown.undo()
          }}
        >
          Undo
        </button>
      </div>
    </div>
  )

  return { banner, toggleTask, toggleBlock }
}
