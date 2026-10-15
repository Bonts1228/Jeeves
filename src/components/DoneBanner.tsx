import { useSyncExternalStore } from 'react'
import { tickBlock, untickBlock } from '../db/day'
import { completeTask, tickGoal, uncompleteTask } from '../db/tasks'
import type { Block, Goal, Task } from '../types'
import { currentBanners, showBanner, subscribeBanners } from '../lib/banners'
import { useDetailsStep } from './DetailsForm'

// The app's Undo banners (lib/banners), shown by whichever screen is mounted (Layout's main screens,
// Focus, goal and project screens), so they outlive the sheet or screen that raised them: a Capture
// closing mid-banner carries its re-plan Undo to Home. A tick's banner sits under it, never over it.
export function DoneBanner({ aboveBar = false }: { aboveBar?: boolean }) {
  const shown = useSyncExternalStore(subscribeBanners, currentBanners)
  if (!shown.length) return null
  return (
    <div
      className={`fixed inset-x-0 z-30 mx-auto flex max-w-md flex-col gap-2 px-4 ${
        aboveBar ? 'bottom-[calc(5rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(1rem+env(safe-area-inset-bottom))]'
      }`}
    >
      {shown.map((b) => (
        <div
          key={b.kind}
          role="status"
          className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-stone-900 pl-4 pr-1 text-white shadow-lg"
        >
          <p className="min-w-0 flex-1 py-2">{b.label}</p>
          <button
            type="button"
            className="h-11 shrink-0 rounded-lg px-4 font-medium active:bg-stone-700"
            onClick={async () => {
              showBanner(null, b.kind)
              await b.undo()
            }}
          >
            Undo
          </button>
        </div>
      ))}
    </div>
  )
}

// Ticking done (task or block goal), with an Undo banner for a few seconds after each tick. If the
// goal records details, the details form comes first (sheet); cancelling it ticks nothing.
// Undo later: tap the filled tick again. now: when it was done (the Unfinished sheet's block end).
export function useDone() {
  const details = useDetailsStep()

  const doneTask = async (task: Task, { now }: { now?: Date } = {}) => {
    showBanner(null)
    await details.ask(await tickGoal(task.id), async (d) => {
      await completeTask(task.id, { details: d, now })
      showBanner({ label: `✓ ${task.title}`, undo: () => uncompleteTask(task.id) })
    })
  }

  const toggleTask = async (task: Task) => {
    if (task.status !== 'done') return doneTask(task)
    showBanner(null)
    await uncompleteTask(task.id)
  }

  const tickGoalBlock = async (block: Block, goal: Goal, { now }: { now?: Date } = {}) => {
    showBanner(null)
    await details.ask(goal, async (d) => {
      await tickBlock(block.id, { details: d, now })
      showBanner({ label: `✓ ${goal.title}`, undo: () => untickBlock(block.id) })
    })
  }

  const toggleBlock = async (block: Block, goal: Goal, ticked: boolean) => {
    if (!ticked) return tickGoalBlock(block, goal)
    showBanner(null)
    await untickBlock(block.id)
  }

  return { toggleTask, toggleBlock, doneTask, tickGoalBlock, details }
}
