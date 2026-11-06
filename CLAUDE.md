# CLAUDE.md — Daily Brief app (prototype)

## What this is

A phone-first planner built on Getting Things Done. At a time the user chooses (usually the evening before), the app builds a **daily brief**: tomorrow's tasks placed into the user's time blocks, filled only to the hours they say they have. During the day it makes the next task obvious. Goals and projects feed the Backlog underneath.

This repo is the **first prototype**: single user (the owner), installable web app (PWA), simple rules, **no accounts, no onboarding**. Data is seeded by hand. **No AI until M9**; from M9 AI connects for project step lists, then destination suggestions and dependencies.

Full product brief and decisions: "Product Brief v2" doc (tabs: Product Brief v2, Prototype spec — see "Iteration 2 (M7–M11)").

## Principles (apply to every screen)

1. The next task is always obvious. One clear thing to do now.
2. Task entry costs almost nothing. A task carries at most title, estimate and area.
3. Capacity, not completeness: fill Today to the hours set, never to everything. Whether there is 1 hour or 7, the brief prioritises focus on core goals.
4. Suggest with a reason; the user decides. Every brief item shows a one-line reason and can be removed.
5. Progress is a number (actions completed against goals), never a coloured status.
6. No upkeep: Backlog stays out of sight; overdue items are resolved by prompts. Jeeves (AI, from M9) takes the admin out of the list.

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

## Data schema (M1–M6, as built)

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

## Schema changes for Iteration 2 (apply in M7)

```typescript
type GoalType = 'open_path' | 'recurring';  // 'set_path' goals migrate to Projects
interface Goal {
  // ...as above, plus:
  isHousekeeping?: boolean;                 // one system goal; no target; excluded from contribution view
}

interface Project {
  id: ID; title: string;
  goalId: ID;                               // a core goal, or the Housekeeping goal
  // areaId removed: area comes from the goal
}

interface Task {
  // ...as above, but:
  goalId: ID;                               // required: every task has a home (Housekeeping if nothing else)
  projectId?: ID;                           // optional container under that goal
  order?: number;                           // SUGGESTED order only — never blocks scheduling
  // areaId derived from the goal; keep the field for blocks, set automatically
}

// InboxItem removed. Migrate existing items to Housekeeping tasks.
```

- **Hierarchy:** Goal → Project (optional) → Task. Projects without a core goal sit under Housekeeping.
- **Progress** = count of LogEntries (actions completed) per goal and period. Time is secondary, summed from task estimates. Projects roll up to their goal.

## Brief rules v0

1. **Make tomorrow's blocks** from the templates for that weekday. Skip protected blocks.
2. **Rank candidate tasks**, highest first:
   1. Overdue — reason "Overdue from Tue"
   2. Due by tomorrow — "Due Thu"
   3. Recurring goals behind pace — "3 left this week"
   4. Next step of each project, by **suggested** `order` (from M7: a soft preference, never a gate) — "CFA: next unit"
   5. Everything else in the Backlog, oldest first — "Waiting since 2 Oct"
3. **Fill blocks in time order.** A task goes in the first block of its area with room for its whole estimate. Never split tasks.
4. **Stop at capacity:** the lower of the day's capacity setting and total block time.
5. **Save each placement** as `status: 'scheduled'` with `date`, `blockId`, `reason`.

Other rules:

- **Unfinished at block end:** prompt per task with three buttons — **Next block** (same area), **Pick a block**, **Back to Backlog**. Each increments `rollovers`. Still unscheduled at end of day → Overdue.
- **Overdue:** visible on Home; prompt to reschedule or delete. (Keep as is — confirmed working well.)
- **Urgent capture:** a task due today re-runs step 3 for today's remaining blocks. Displaced tasks go back to the Backlog; show a banner with the reason and an Undo.
- **Progress:** ticking a task writes a LogEntry. If its goal has `detailFields`, show a small skippable form first.
- **From M10:** blocks are suggestions. Editing a block (move or resize) re-runs step 3 for that day.

## Screens

Bottom bar on main screens: **Plan** · **+ (quick capture)** · **Backlog**.

| Screen | Purpose |
| --- | --- |
| Home / day view | Scrollable list of today's blocks; "Up next" hero card with the next task and Start block; Overdue card |
| Focus block | Block name and time left, goal link ("2 of 5 this week"), current task with Done, then the block's other tasks |
| Unfinished prompt | Bottom sheet at block end: Next block / Pick a block / Back to Backlog |
| Brief review | Tomorrow's tasks grouped by block, reason under each, remove (×), "+ Add from Backlog", Confirm brief |
| Backlog | Goals (with Housekeeping) → projects → tasks; no Inbox from M8 |
| Capture | Bottom sheet: title + destination picker (from M8); estimate defaulted |
| Goal detail (M11) | Actions completed per week and month over 1+ months, broken down by project |
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

### Iteration 2 (decided 3 Nov, from first use)

| Milestone | Builds | Done when |
| --- | --- | --- |
| M7 Hierarchy | Goal → Project → Task + Housekeeping; set-path goals become projects; migrate seed data and Inbox items (schema changes above) | Every task has a home |
| M8 Capture | Title + destination picker (recent destinations first), estimate defaulted, area inherited, Inbox removed | Capture in under 5 seconds |
| M9 Project workflow + AI | Create project → AI-generated step list (manual/template fallback) → tick steps already done → rest go to Backlog in suggested order | Motorbike sale set up in under 2 minutes |
| M10 Editable blocks | Templates generate suggested blocks; drag or resize in day view and brief review; re-plan on edit | Moving a block earlier or later re-plans the day |
| M11 Contribution view | Goal detail: actions completed per week and month over 1+ months, by project; time from estimates as secondary | October's progress is visible per goal |

**Parallel design track (not code):** capture entry mockups, then a colour system — colour carries meaning first, brand second. Ready before any visual polish milestone.

**After M9 (AI layer, later):** destination suggestions on capture, project dependencies, hierarchy help. Every AI feature keeps a manual fallback.

## Seed data

Seed with the owner's real week (provided at the start of M1): real blocks per weekday plus at least one protected block; one goal of each type (set path, open path, recurring with detail fields); one project with 4–6 steps; 20–30 real tasks with estimates, a few with due dates. Keep the seed script re-runnable.

From M7, core goals: job acquisition, course progress, coding this app, gym — plus Housekeeping (e.g. the motorbike sale project).

## Self-test

Run it daily after M4. Each evening, one line: did the brief fit the day, and what changed? Success test: **trusting Today enough to stop checking the Backlog.**

## Out of scope — do not build

- AI before M9; from M9 only the project step list, then the AI layer above
- Onboarding screens
- Voice capture, weekly/monthly reviews, calibration nudges
- Notifications, two-way calendar sync, agentic hand-off (Google Calendar read-only may come after M10)
- Accounts, device sync, pricing, the free-tier task cap
