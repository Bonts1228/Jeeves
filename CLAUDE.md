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
  servedByBlocks?: boolean;                 // recurring only: true = every block in areaId counts
                                            // as one occurrence (every Gym block serves lifting);
                                            // false/absent = runs as a count of ticked tasks
  detailFields?: string[];                  // e.g. ['role', 'company']
}

interface Project {
  id: ID; title: string; areaId: ID;
  goalId?: ID;                              // done steps log against this goal
  manualOnly?: boolean;                     // e.g. Housekeeping: see "Manual-only projects"
  notBefore?: ISODate;                      // held back until this date (never auto-cleared)
  startsAfterProjectId?: ID;                // held back until that project has nothing open; then cleared
}

type Repeat =
  | { kind: 'every'; days: number }         // laundry: every 8 days from when last done
  | { kind: 'weekly'; weekday: 0|1|2|3|4|5|6 };  // meal plan: every Sunday

type TaskStatus = 'backlog' | 'scheduled' | 'done' | 'deleted';
interface Task {
  id: ID; title: string;
  estimate: Minutes; areaId: ID;
  goalId?: ID; projectId?: ID; order?: number;  // step position in a set path or project
  due?: ISODate;
  repeat?: Repeat;                          // requires due; see "Repeating tasks"
  prevId?: ID;                              // the occurrence this one follows
  status: TaskStatus;
  date?: ISODate; blockId?: ID;             // set when scheduled
  reason?: string;                          // one-line reason shown in the brief
  rollovers: number;                        // times moved on unfinished: calibration signal
  delegable: boolean;
  createdAt: string;
}

interface LogEntry {
  id: ID; goalId?: ID;
  taskId?: ID;                              // a ticked task, or
  blockId?: ID;                             // a ticked block of a servedByBlocks goal
  completedAt: string;
  details?: Record<string, string>;         // e.g. { role: 'Analyst', company: '…' }
}

interface InboxItem { id: ID; text: string; createdAt: string; }

// meta: key-value facts about this device, never exported. 'lastExportAt' → ISO time.
```

- **Overdue** = `status === 'scheduled' && date < today`.
- **Progress** = log entries for a goal within its current period, compared with `target`.
  A task's goal is `task.goalId`, else its project's `goalId`.
- **One-off blocks** are Blocks with no `templateId`, created for a single date.
- **No timer.** Ticking done is the only completion signal.
- **Export / import:** one JSON file `{ app, schemaVersion, exportedAt, settings, tables }` of every data table (not `meta`). Import checks the whole file first (JSON, app, version not newer, required fields, duplicate ids), upgrades older versions with the same migrations as the database (`src/db/migrations.ts`), confirms, then replaces everything in one transaction. Bump `SCHEMA_VERSION` with every `db.version()`.

## Brief rules v0

1. **Make tomorrow's blocks** from the templates for that weekday. Skip protected blocks.
2. **Rank candidate tasks**, highest first:
   1. Overdue — reason "Overdue from Tue"
   2. Due by tomorrow — "Due Thu"
   3. Recurring count goals behind pace — "3 left this week" (`servedByBlocks` goals are served by their blocks, not tasks)
   4. Next step of each set path or project, by `order` — "CFA: next unit" (skip manual-only and held-back projects)
   5. Everything else in the Backlog, oldest first — "Waiting since 2 Oct" (skip manual-only project tasks and repeating tasks)
3. **Fill blocks in time order.** A task goes in the first block of its area with room for its whole estimate. A manual-only project task goes in the first non-protected block of any area with room. Never split tasks.
4. **Stop at capacity:** the lower of the day's capacity setting and total block time.
5. **Save each placement** as `status: 'scheduled'` with `date`, `blockId`, `reason`.

Clarified in M3 (`src/lib/brief.ts`):

- **Overdue at brief time** is `scheduled` with `date` before the brief date, so today's leftovers count ("Carried from today"). Moving one onto the brief date increments `rollovers`.
- **One step per path per day:** rule 2.4 skips a path that already has a step on the brief date. Rule 2.5 skips later steps of ordered lists (they wait their turn).
- **No block for the task's area** (none that day, or only protected ones): the task is skipped, uses no capacity, and stays in the Backlog unchanged. Ranking carries on. Brief review lists it under **Not placed** ("No Gym block Thu") with **Add** (block picker + New block).
- **Over capacity:** a task that would go past the cap is skipped and filling continues with smaller, lower-ranked tasks. Tier 1–4 tasks left out show under Not placed with the reason; tier 5 leftovers don't.
- **Refill** only adds into the room left and never moves what's placed. Tasks removed at review (×) go back to the Backlog and stay out of refills for that date. Brief state (`builtAt`, `confirmedAt`, `removed`) lives in `meta` under `brief:<date>`.

Clarified in M4 (`src/lib/day.ts`):

- **Order within a block** is derived, never stored: the brief's tiers (overdue — known by its reason, carried-from-today after older days — then due ascending, recurring count goals, path steps by path deadline/title/`order`, then oldest). Open tasks first, done ones after. No reorder: every task has its own Done tick, and the current task is the first open one.
- **Up next** (today's non-protected blocks; a block has work if it has an open task or an unticked block goal): the current block with work, else the next later block with work (start early allowed), else leftovers from ended blocks, else "Today's done". Nothing dated today and no `brief:<today>` → "Plan today" (Brief review with `?date=today`).
- **Start block** only opens the Focus view. **Time left** is wall clock to the block's end; nothing is stored, and a block never started changes nothing.
- **Block goals:** the block tick writes the goal's LogEntry (at most one per block; untick removes it). A task for a `servedByBlocks` goal done inside a block of that goal's area logs without `goalId` (the block tick covers it); done anywhere else it counts.
- **Progress** counts entries in the whole current period (period start to the next period's start).
- **Undo:** each tick shows an Undo banner for a few seconds; tapping a filled tick undoes it any time.

Clarified in M5 (`src/lib/unfinished.ts`, `src/db/unfinished.ts`, `src/db/day-blocks.ts`):

- **Unfinished** = scheduled today in a block that has ended or no longer exists. With no notifications, Home opens one **Unfinished sheet** for all of them (grouped by block) when the app is looked at: on open, on return to the foreground, every 30s, unless another sheet is showing. Focus shows "Block ended · n unfinished" with Sort out.
- **Next block:** the first block of the task's area (any area for manual-only) with room for the whole estimate that hasn't ended, today first, then tomorrow; disabled with the reason if none. **Pick a block:** today or tomorrow, blocks with room or New block. **Back to Backlog** clears `date`, `blockId`, `reason`. All three add a rollover; the task keeps its reason when moved.
- **Block goals at block end:** an ended block whose `servedByBlocks` goal is unticked joins the sheet ("Lifting · did you train?"): **Done** ticks it with `completedAt` = block end; **Skipped** writes nothing and stops asking for that block (`skipped:<blockId>` in the dismissed list); **Move session** offers the next same-area block today or tomorrow that hasn't ended or been ticked ("To Fri 17:30"), or **New block** (the block editor, area preset). Moving writes nothing and stops asking for the ended block (`moved:<blockId>`); the moved-to block asks in turn if it ends unticked. The goal counts only when a block is ticked. Later works as for tasks (`block:<blockId>`).
- **Later** (or closing the sheet) changes nothing on the tasks; their ids go to `meta` `unfinished:<date>` so the sheet only reopens for new ones. They stay on Home ("n unfinished · Sort out"), then tomorrow's brief carries them or they become Overdue.
- **Overdue card** on Home (scheduled before today): Reschedule (as Pick a block, plus Back to Backlog; a rollover) or Delete.
- **Rule 2.1 tightened:** "Carried from today" only takes tasks whose block has ended (or is gone) when the brief is built; tasks in today's blocks still to come stay put.
- **Per-day block editor** (Edit blocks on Home and Brief; today or tomorrow): edit times, delete, add an empty one-off block. No overlaps; today a block must end after now. Deleting today's block leaves its tasks pointing at it, so they're Unfinished; deleting a later day's block sends its tasks back to the Backlog with no rollover (they rank again in that day's brief, Not placed if they don't fit). Templates are never touched.
- **Quick add:** "+ Add to this block" on Focus and Home's block cards, on any of today's non-protected blocks until it ends (running or still to come; `canQuickAdd`), opens Capture with that block fixed and its area preset (any area allowed). It's added even past the block's room, showing "n min over".
- **Sheets** close by backdrop, Escape, Later/Close, or a swipe down on the handle/title (a quarter of the height or a fast flick), all the same way.
- `ensureBlocks` marks a made day in `meta` `blocks:<date>` so a day edited down to no template blocks isn't remade; import clears these flags.

Clarified in M6 (`src/lib/progress.ts`, `src/lib/replan.ts`, `src/db/replan.ts`, `src/components/DetailsForm.tsx`, `src/components/DoneBanner.tsx`):

- **Backlog numbers:** a goal with target and period shows "2 of 5 this week" and under it "1 behind · 4 days left · By 31 Dec". Behind = the even-pace count by the start of today (`expectedBy`, shared with rule 2.3) minus what's logged; shown only when behind. Goals with detail fields add "Last: Analyst, Acme".
- **Details on tick:** the form shows before the LogEntry is written when the goal the tick logs against (`loggedGoal`: none for a task covered by its served-by-blocks block) has `detailFields`: Home, Focus, task sheet Mark done, Unfinished (Did it, "did you train?" Done). Save logs the filled-in fields, Skip logs with no details, cancelling (backdrop, Escape, swipe) ticks nothing. Last values show as placeholders. Undo removes the entry with its details.
- **Recent** on the goal screen: the last 10 entries (when, task or block, details). With detail fields, tap one to edit its details; time and goal never change.
- **Did it** on Unfinished task cards: done as of the block's end (now, if the block was deleted), no rollover.
- **Banner:** app-wide Undo banners (`src/lib/banners.ts`), shown by Layout, Focus and the goal/project screens, so they outlive the sheet that raised them. One slot per kind (`replan`, `done`), each on its own ~6s clock: a tick never wipes a showing re-plan Undo (it stacks under it); a new banner replaces only its own kind.
- **Urgent capture** (Capture or Inbox → task, due today, no block or schedule picked): the first remaining (not ended) non-protected block of its area (any area for manual-only) with room; else the first where moving out its lowest-ranked tasks (end of the block's order first; any taken but not needed go back) makes room. Never moved: done, overdue/carried, due today or earlier, "Added by you", the current task of the running block. Moved tasks (highest-ranked first) go to another remaining block of their area with room while the day (scheduled + done) stays within capacity, else to the Backlog; no rollover, reason kept. The urgent task's reason is "Due today" and it may go over capacity. Capture shows "Due today: X → Work 14:00 · moved Y → 16:00" with Undo; closing the sheet carries it to the banner (~6s). Undo restores the snapshot in one transaction (moved tasks exactly, Inbox item back, new task removed); anything changed since is left alone and named. Fits nowhere: saved to the Backlog due today, nothing moved, "Not placed: no Work block left today with 1h free" with Pick a block. Editing a task's due date to today doesn't re-plan.
- No schema change: `details` existed; import now rejects details that aren't text.

Other rules:

- **Repeating tasks:** ticking done creates the next occurrence: a copy with a new id, `status: 'backlog'`, `rollovers: 0`, and `due` set to completion date + N days (`every`), or the given weekday strictly after the later of completion date and old due date (`weekly`, so finishing Sat for a Sun task goes to the following Sun). Only done creates the next one. Delete ends the series, and Back to Backlog keeps the same occurrence. A task has at most one next occurrence (`prevId`), so ticking twice or tick → undo → tick never duplicates. **Undo done** reopens the task (`scheduled` if it has a date, else `backlog`), removes its latest LogEntry, and removes the next occurrence if it is still open (a done or deleted one stays). Repeating tasks enter the brief only through rules 2.1/2.2. Reason shows the cadence: "Due Sun · weekly".
- **Manual-only projects (Housekeeping):** life admin not tied to a goal. Their tasks are never auto-placed unless overdue or due by tomorrow. You add them yourself, at Brief review ("+ Add from Backlog") or on capture ("Schedule" chip: today/tomorrow + block). The picker lists every non-protected block that day with room for the whole estimate, any area, plus **New block** (start/end → one-off Block in the task's area, not protected). Reason: "Added by you". Manual adds may exceed capacity. Brief review then shows "n min over" and does not block.
- **Step order:** a set-path goal's tasks and a non-manual project's tasks are ordered: every non-deleted step, done ones included, has `order` 1..n with no gaps or duplicates. New or moved-in steps go last; delete closes the gap; a done step keeps its place; a repeating step's next occurrence goes last. Reorder with ↑/↓ (swaps with the nearest open step). Other tasks have no `order`. Changing a goal's type or a project's manual-only flag renumbers: becoming ordered numbers steps oldest first, becoming unordered clears `order`.
- **Project hold-back:** a project is held back while `notBefore` is after the date (the brief date, or today in the Backlog) or while `startsAfterProjectId` is set. Held-back projects stay out of rules 2.3–2.5; their overdue and due steps still rank via 2.1/2.2, and you can add steps yourself. The Backlog shows them last under **Later** with why ("Not before 2 Nov", "After X"); if X has an open repeating step it shows "After X (X repeats, won't finish)" so you can clear the wait by hand. `startsAfterProjectId` clears when X's last open step is done, deleted or moved out, or X is deleted; saving it against an X with nothing open doesn't keep it; undo done doesn't bring it back. The picker leaves out the project itself, manual-only projects and anything that would form a loop. Import rejects a bad `notBefore`, a missing X, and loops of any length.
- **Deleting a goal or project** confirms first with counts: open tasks are kept as loose Backlog tasks or deleted, as chosen; done tasks stay as history, unlinked; projects feeding a deleted goal stay, unlinked; projects waiting on a deleted project start. Log entries are never touched (nor by target/period edits: progress recomputes).
- **Block goals:** each block in a `servedByBlocks` goal's area gets a Done tick (detail form first if the goal has `detailFields`). It writes a LogEntry with `blockId` and `goalId`.
- **Unfinished at block end:** prompt per task with three buttons — **Next block** (same area), **Pick a block**, **Back to Backlog**. Each increments `rollovers`. **Did it** (M6) ticks it instead, no rollover. Still unscheduled at end of day → Overdue.
- **Overdue:** visible on Home; prompt to reschedule or delete.
- **Urgent capture:** a task due today re-runs step 3 for today's remaining blocks. Displaced tasks go to another remaining block or back to the Backlog; show a banner with the reason and an Undo (details under M6).
- **Progress:** ticking a task writes a LogEntry. If its goal has `detailFields`, show a small skippable form first.

## PWA updates

A new deploy reaches the phone without reinstalling. `vite-plugin-pwa` with `registerType: 'prompt'` (`autoUpdate` reloads mid-use), driven by `src/lib/pwa-update.ts`. The app checks for a new service worker on launch and whenever it returns to the foreground (`visibilitychange`). A new version installs in the background and is applied (reload) only when the app comes to the foreground, never while it is in use. Vercel serves everything except hashed `/assets/` (incl. `sw.js`, `index.html`, the manifest) with `Cache-Control: no-cache`.

## Screens

Bottom bar on main screens: **Plan** · **+ (quick capture)** · **Backlog**.

| Screen | Purpose |
| --- | --- |
| Home / day view | Scrollable list of today's blocks; "Up next" hero card with the next task and Start block; Overdue card |
| Focus block | Block name and time left, goal link ("2 of 5 this week"), current task with Done, then the block's other tasks |
| Unfinished prompt | Bottom sheet at block end: Next block / Pick a block / Back to Backlog, or Did it |
| Brief review | Tomorrow's tasks grouped by block, reason under each, remove (×), "+ Add from Backlog", Confirm brief |
| Backlog | Inbox count, Goals with progress numbers, Projects with "n of m steps", held-back projects last under "Later" |
| Capture | Bottom sheet: text input, chips for estimate / area / goal / due, To Inbox or Add to Backlog |
| Settings | Brief time, capacity per weekday, areas, block templates, backup (export / import, last export date) |

Mockups: "Product Mural" design canvas (Phone · Home, Focus block, Unfinished prompt, Brief review, Backlog, Capture).

## Build order

Work one milestone at a time. Each must be usable on the phone before moving on.

| Milestone | Builds | Done when |
| --- | --- | --- |
| M1 Shell | PWA scaffold, bottom bar, Dexie database, seed script, Settings (areas, block templates, capacity) | Installed on phone home screen; seed data visible |
| M2 Backlog + capture | PWA auto-update; Capture sheet → Inbox; task create/edit incl. repeat rule (next occurrence on done, unit-tested); goals (3 types; recurring as count or area blocks) and projects (optional goal link, manual-only flag); Housekeeping scheduling from capture into a block with room or a new one-off block; Backlog screen; data export / import | A week's real tasks entered in under 10 minutes; a redeploy shows on the phone on next launch without reinstalling |
| M3 Brief | Brief rules v0 incl. manual-only and repeating rules; Brief review screen with remove and "+ Add from Backlog" (any-area block picker + New block for manual-only tasks); Confirm | Tomorrow's brief fills blocks sensibly, each item with a reason |
| M4 Day + focus block | Home with Up next; Focus block view; Done writes a LogEntry and creates the next occurrence of repeating tasks; Done tick on goal blocks | A full day can be run from the phone |
| M5 Unfinished + overdue | Block-end prompt; end-of-day overdue; reschedule/delete prompts | Nothing silently disappears |
| M6 Progress + re-plan | Goal counters on Backlog; detail fields on tick; urgent-capture re-plan with Undo | Backlog shows goals as numbers that move |

## Seed data

Seed with the owner's real week (provided at the start of M1): real blocks per weekday plus at least one protected block; one goal of each type (set path, open path, recurring with detail fields, served by its area's blocks); one project with 4–6 steps linked to a goal; Housekeeping as a manual-only project; 20–30 real tasks with estimates, a few with due dates, and repeating tasks (laundry every 8 days, meal plan every Sunday). Keep the seed script re-runnable.

## Self-test

Run it daily after M4. Each evening, one line: did the brief fit the day, and what changed? Success test: **trusting Today enough to stop checking the Backlog.**

## Parked ideas

Not approved for building. Recorded so they aren't lost.

**v2 (assistant)**
- AI-suggested tasks that the user ticks to keep or deletes.
- Prospecting outreach with message templates.
- Claude connection.

**Candidates, not yet approved**
- Design pass after M4: visual polish across all screens.
- Do now / reorder within a block: today a block's order is derived from the brief's tiers.
- Several steps per path per day: a per-goal/project setting so a short next step can follow one already placed that day (today the brief adds one step per path per day).
- Project end date.
- Calendar-style block picker: a visual day schedule (timeline) to tap a block or drag out a new one, and to drop a new task into any block or straight onto today's schedule. Used by Capture, Unfinished, Pick a block and Schedule. For the design pass.
- Follow-up nudges: ticking an outreach task creates a follow-up due in N days, cancelled if the outreach is marked replied.

## Out of scope — do not build

- AI of any kind (task drafting, goal breakdown, ramble onboarding)
- Onboarding screens
- Voice capture, weekly/monthly reviews, calibration nudges
- Notifications, calendar sync, agentic hand-off
- Accounts, device sync, pricing, the free-tier task cap

## Git workflow

- Never commit to main. Work on a branch named `feat/<milestone>-<slug>`.
- Small conventional commits (`feat:`, `fix:`, `chore:`). Run build before each commit.
- Build one milestone at a time; stop and summarise when its "Done when" is met.
- Never merge into main yourself. I review and merge.
