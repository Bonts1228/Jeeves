import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Capture } from '../components/Capture'
import { dangerBtn, secondaryBtn } from '../components/ui'
import { db } from '../db/db'
import type { InboxItem } from '../types'

// Captured text waiting to become tasks. Tap one to fill in the task fields; saving removes it.
export function Inbox() {
  const items = useLiveQuery(() => db.inbox.toArray())
  const [processing, setProcessing] = useState<InboxItem | null>(null)
  if (!items) return null
  const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return (
    <>
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-stone-500">Inbox is empty.</p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-xl bg-white">
          {sorted.map((item) => (
            <InboxRow key={item.id} item={item} onOpen={() => setProcessing(item)} />
          ))}
        </ul>
      )}
      {processing && (
        <Capture
          init={{ text: processing.text, inboxId: processing.id }}
          onClose={() => setProcessing(null)}
        />
      )}
    </>
  )
}

function InboxRow({ item, onOpen }: { item: InboxItem; onOpen: () => void }) {
  const [confirming, setConfirming] = useState(false)

  if (confirming)
    return (
      <li className="flex items-center gap-2 bg-red-50 px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-sm text-red-900">Delete “{item.text}”?</span>
        <button type="button" className={secondaryBtn} onClick={() => setConfirming(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="h-11 rounded-lg bg-red-700 px-4 font-medium text-white"
          onClick={() => db.inbox.delete(item.id)}
        >
          Delete
        </button>
      </li>
    )

  return (
    <li className="flex items-center gap-1 pr-2">
      <button type="button" onClick={onOpen} className="min-h-14 flex-1 px-4 py-2 text-left font-medium active:bg-stone-50">
        {item.text}
      </button>
      <button type="button" className={dangerBtn} aria-label={`Delete ${item.text}`} onClick={() => setConfirming(true)}>
        Delete
      </button>
    </li>
  )
}
