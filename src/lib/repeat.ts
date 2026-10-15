import type { ISODate, Repeat } from '../types'
import { addDays, nextWeekday } from './dates'

// Due date of the next occurrence of a repeating task ticked done on completedOn.
// 'every' counts from completion, so a late task doesn't come straight back.
// 'weekly' goes to the given weekday after the later of completion and the old due date,
// so finishing early (Sat for a Sun task) doesn't land on the occurrence just done.
export function nextDue(repeat: Repeat, completedOn: ISODate, due?: ISODate): ISODate {
  if (repeat.kind === 'every') return addDays(completedOn, repeat.days)
  const from = due && due > completedOn ? due : completedOn
  return nextWeekday(from, repeat.weekday)
}
