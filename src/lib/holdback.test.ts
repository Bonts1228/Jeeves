import { describe, expect, it } from 'vitest'
import type { Project, Task } from '../types'
import { findWaitLoop, heldBackLabel, isHeldBack, waitCandidates } from './holdback'

const project = (id: string, extra: Partial<Project> = {}): Project => ({ id, title: id.toUpperCase(), areaId: 'focus', ...extra })
const step = (projectId: string, extra: Partial<Task> = {}): Task => ({
  id: `${projectId}-${Math.random()}`,
  title: 'Step',
  estimate: 30,
  areaId: 'focus',
  projectId,
  status: 'backlog',
  rollovers: 0,
  delegable: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...extra,
})

describe('hold-back', () => {
  it('holds back until the notBefore date, and while waiting on a project', () => {
    expect(isHeldBack({ notBefore: '2026-10-16' }, '2026-10-15')).toBe(true)
    expect(isHeldBack({ notBefore: '2026-10-16' }, '2026-10-16')).toBe(false)
    expect(isHeldBack({ startsAfterProjectId: 'b' }, '2026-12-31')).toBe(true)
    expect(isHeldBack({}, '2026-10-15')).toBe(false)
  })

  it('finds loops of waits of any length', () => {
    expect(findWaitLoop([project('a', { startsAfterProjectId: 'b' }), project('b')])).toBeNull()
    expect(findWaitLoop([project('a', { startsAfterProjectId: 'a' })])).toEqual(['a'])
    expect(findWaitLoop([project('a', { startsAfterProjectId: 'b' }), project('b', { startsAfterProjectId: 'a' })])).toEqual(['a', 'b'])
    const chainIntoLoop = [
      project('x', { startsAfterProjectId: 'a' }),
      project('a', { startsAfterProjectId: 'b' }),
      project('b', { startsAfterProjectId: 'c' }),
      project('c', { startsAfterProjectId: 'a' }),
    ]
    expect(findWaitLoop(chainIntoLoop)).toEqual(['a', 'b', 'c'])
  })

  it('offers projects to wait on: not itself, not manual-only, not one already waiting on it', () => {
    const projects = [
      project('a'),
      project('b', { startsAfterProjectId: 'a' }),
      project('c', { startsAfterProjectId: 'b' }),
      project('house', { manualOnly: true }),
      project('d'),
    ]
    expect(waitCandidates('a', projects).map((p) => p.id)).toEqual(['d'])
    expect(waitCandidates('c', projects).map((p) => p.id)).toEqual(['a', 'b', 'd'])
    expect(waitCandidates(undefined, projects).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it("labels the Later row, flagging a project it waits on that repeats and won't finish", () => {
    const projects = [project('a', { startsAfterProjectId: 'b' }), project('b'), project('c', { notBefore: '2026-11-02' })]
    expect(heldBackLabel(projects[2], projects, [])).toBe('Not before 2 Nov')
    expect(heldBackLabel(projects[0], projects, [step('b')])).toBe('After B')
    const repeating = step('b', { due: '2026-10-20', repeat: { kind: 'every', days: 7 } })
    expect(heldBackLabel(projects[0], projects, [step('b'), repeating])).toBe("After B (B repeats, won't finish)")
    // A done repeating step whose series ended doesn't count
    expect(heldBackLabel(projects[0], projects, [{ ...repeating, status: 'done' }])).toBe('After B')
  })
})
