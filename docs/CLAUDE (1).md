# CLAUDE.md — Daily Brief app (prototype)

## What this is

A phone-first planner built on Getting Things Done. At a time the user chooses (usually the evening before), the app builds a **daily brief**: tomorrow's tasks placed into the user's time blocks, filled only to the hours they say they have. During the day it makes the next task obvious. Goals and projects feed the Backlog underneath.

This repo is the **first prototype**: single user (the owner), installable web app (PWA), simple rules, **no AI, no accounts, no onboarding**. Data is seeded by hand.

Full product brief and decisions: "Product Brief v2" doc (tabs: Product Brief v2, Prototype spec).

## Principles (apply to every screen)

1. The next task is always obvious. One clear thing to do now.
2. Task entry costs almost nothing.
3. Capacity, not completeness: fill Today to the hours set, never to everything.
4. Suggest with a reason; the user decides. Every brief item shows a one-line reason and can be removed.
5. Progress is a number (counts against targets), never a coloured status.
6. No upkeep: Backlog stays out of sight; overdue items are resolved by prompts.

## Stack

| Layer | Choice |
| --- | --- |
| App | React + TypeScript, Vite |
| PWA | `vite-plugin-pwa` (manifest + offline, installable on phone) |
| Styling | Tailwind CSS |
| Storage | IndexedDB via Dexie — local only, no login |
| Hosting | Vercel (free tier) |

**Decided 14 Oct:** phone only for the first two weeks. No sync. Sync (Supabase) and richer laptop/desktop planning views come later — don't build them now.

Design for a 390px-wide phone first. Touch targets ≥ 44px. Real `<button>`/`<input>`/`<label>` elements.

## Data schema

Overdue and progress are computed, never stored.

```typescript
type ID = string;            // uuid
type ISODate = string;       // '2026-10-15'
type Minutes = number;

interface Settings {
  briefTime: string;                        // '20:00'
  capacity: Record<0|1|2|3|4|5|6, Minutes>; // per weekday, 0 = Sunday
}

interface Area { id: ID; name: string; }    // presets: Work, Workout, Family, Hobbies

interface BlockTemplate {
  id: ID; areaId: ID;
  weekday: 0|1|2|3|4|5|6;
  start: string; end: string;               // '09:00', '11:00'
  protected: boolean;                       // true = no tasks placed (e.g. Family)
}

interface Block {                           // generated per date from templates; editable per day
  id: ID; templateId?: ID; areaId: ID;
  date: ISODate; start: string; end: string; protected: boolean;
}

type GoalType = 'set_path' | 'open_path' | 'recurring';
interface Goal {
  id: ID; title: string; type: GoalType; areaId: ID;
  target?: number;                          // e.g. 5
  period?: 'week' | 'month';
  deadline?: ISODate;
  recurringBlockId?: ID;                    // recurring goals run as a count OR a reserved block
  detailFields?: string[];                  // e.g. ['role', 'company']
}

interface Project { id: ID; title: string; areaId: ID; }

type TaskStatus = 'backlog' | 'scheduled' | 'done' | 'deleted';
interface Task {
  id: ID; title: string;
  estimate: Minutes; areaId: ID;
  goalId?: ID; projectId?: ID; order?: number;  // step position in a set path or project
  due?: ISODate;
  status: TaskStatus;
  date?: ISODate; blockId?: ID;             // set when scheduled
  reason?: string;                          // one-line reason shown in the brief
  rollovers: number;                        // times moved on unfinished: calibration signal
  delegable: boolean;
  createdAt: string;
}

interface LogEntry {
  id: ID; taskId: ID; goalId?: ID;
  completedAt: string;
  details?: Record<string, string>;         // e.g. { role: 'Analyst', company: '…' }
}

interface InboxItem { id: ID; text: string; createdAt: string; }
```

- **Overdue** = `status === 'scheduled' && date < today`.
- **Progress** = log entries for a goal within its current period, compared with `target`.
- **No timer.** Ticking done is the only completion signal.

## Brief rules v0

1. **Make tomorrow's blocks** from the templates for that weekday. Skip protected blocks.
2. **Rank candidate tasks**, highest first:
   1. Overdue — reason "Overdue from Tue"
   2. Due by tomorrow — "Due Thu"
   3. Recurring goals behind pace — "3 left this week"
   4. Next step of each set path or project, by `order` — "CFA: next unit"
   5. Everything else in the Backlog, oldest first — "Waiting since 2 Oct"
3. **Fill blocks in time order.** A task goes in the first block of its area with room for its whole estimate. Never split tasks.
4. **Stop at capacity:** the lower of the day's capacity setting and total block time.
5. **Save each placement** as `status: 'scheduled'` with `date`, `blockId`, `reason`.

Other rules:

- **Unfinished at block end:** prompt per task with three buttons — **Next block** (same area), **Pick a block**, **Back to Backlog**. Each increments `rollovers`. Still unscheduled at end of day → Overdue.
- **Overdue:** visible on Home; prompt to reschedule or delete.
- **Urgent capture:** a task due today re-runs step 3 for today's remaining blocks. Displaced tasks go back to the Backlog; show a banner with the reason and an Undo.
- **Progress:** ticking a task writes a LogEntry. If its goal has `detailFields`, show a small skippable form first.

## Screens

Bottom bar on main screens: **Plan** · **+ (quick capture)** · **Backlog**.

| Screen | Purpose |
| --- | --- |
| Home / day view | Scrollable list of today's blocks; "Up next" hero card with the next task and Start block; Overdue card |
| Focus block | Block name and time left, goal link ("2 of 5 this week"), current task with Done, then the block's other tasks |
| Unfinished prompt | Bottom sheet at block end: Next block / Pick a block / Back to Backlog |
| Brief review | Tomorrow's tasks grouped by block, reason under each, remove (×), "+ Add from Backlog", Confirm brief |
| Backlog | Inbox count, Goals with progress numbers, Projects with "n of m steps" |
| Capture | Bottom sheet: text input, chips for estimate / area / goal / due, To Inbox or Add to Backlog |
| Settings | Brief time, capacity per weekday, areas, block templates |

Mockups: "Product Mural" design canvas (Phone · Home, Focus block, Unfinished prompt, Brief review, Backlog, Capture).

## Build order

Work one milestone at a time. Each must be usable on the phone before moving on.

| Milestone | Builds | Done when |
| --- | --- | --- |
| M1 Shell | PWA scaffold, bottom bar, Dexie database, seed script, Settings (areas, block templates, capacity) | Installed on phone home screen; seed data visible |
| M2 Backlog + capture | Capture sheet → Inbox; task create/edit; goals (3 types) and projects; Backlog screen | A week's real tasks entered in under 10 minutes |
| M3 Brief | Brief rules v0; Brief review screen with remove and "+ Add from Backlog"; Confirm | Tomorrow's brief fills blocks sensibly, each item with a reason |
| M4 Day + focus block | Home with Up next; Focus block view; Done writes a LogEntry | A full day can be run from the phone |
| M5 Unfinished + overdue | Block-end prompt; end-of-day overdue; reschedule/delete prompts | Nothing silently disappears |
| M6 Progress + re-plan | Goal counters on Backlog; detail fields on tick; urgent-capture re-plan with Undo | Backlog shows goals as numbers that move |

## Seed data

Seed with the owner's real week (provided at the start of M1): real blocks per weekday plus at least one protected block; one goal of each type (set path, open path, recurring with detail fields); one project with 4–6 steps; 20–30 real tasks with estimates, a few with due dates. Keep the seed script re-runnable.

## Self-test

Run it daily after M4. Each evening, one line: did the brief fit the day, and what changed? Success test: **trusting Today enough to stop checking the Backlog.**

## Out of scope — do not build

- AI of any kind (task drafting, goal breakdown, ramble onboarding)
- Onboarding screens
- Voice capture, weekly/monthly reviews, calibration nudges
- Notifications, calendar sync, agentic hand-off
- Accounts, device sync, pricing, the free-tier task cap
