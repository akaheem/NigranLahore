import { describe, it, expect } from 'vitest'
import {
  COMPLAINT_STATUSES, TRANSITIONS, canTransition, transitionLabel, statusClaim,
  statusOf, MAX_STATUS_EVENTS,
} from '../../src/data/complaints.js'

/**
 * The lifecycle's rules, on the client side of the wire.
 *
 * `server/src/validate.test.js` pins the same table from the server's side, and
 * the two must agree — but they are asserted separately on purpose. The client
 * copy exists so the UI offers only moves that will be accepted, and a drift
 * between them would show up as a button that always comes back 409. The server
 * is the authority; this is the copy that has to keep up with it.
 */

describe('the transition table', () => {
  it('covers exactly the four states, and every one of them has an entry', () => {
    const ids = COMPLAINT_STATUSES.map(s => s.id)
    expect(ids).toEqual(['filed', 'acknowledged', 'in-progress', 'resolved'])
    for (const kind of ['crew', 'reporter']) {
      for (const id of ids) expect(Array.isArray(TRANSITIONS[kind][id])).toBe(true)
    }
  })

  it('walks a crew from filed to resolved, one step at a time', () => {
    expect(canTransition('filed', 'acknowledged', 'crew')).toBe(true)
    expect(canTransition('acknowledged', 'in-progress', 'crew')).toBe(true)
    expect(canTransition('in-progress', 'resolved', 'crew')).toBe(true)
  })

  it('refuses a crew that skips a step or steps backwards', () => {
    // A crew jumping straight from filed to resolved would claim work that was
    // never recorded as started.
    expect(canTransition('filed', 'in-progress', 'crew')).toBe(false)
    expect(canTransition('filed', 'resolved', 'crew')).toBe(false)
    expect(canTransition('acknowledged', 'filed', 'crew')).toBe(false)
    expect(canTransition('resolved', 'filed', 'crew')).toBe(false)
  })

  it('lets a resident say the problem is gone, from any open state', () => {
    expect(canTransition('filed', 'resolved', 'reporter')).toBe(true)
    expect(canTransition('acknowledged', 'resolved', 'reporter')).toBe(true)
    expect(canTransition('in-progress', 'resolved', 'reporter')).toBe(true)
  })

  it('lets a resident reopen, because water comes back', () => {
    expect(canTransition('resolved', 'filed', 'reporter')).toBe(true)
  })

  it('refuses a resident acknowledging their own report', () => {
    // The honesty core: "acknowledged" is a municipal response, and a citizen
    // cannot assert one. They may only say what they can see.
    expect(canTransition('filed', 'acknowledged', 'reporter')).toBe(false)
    expect(canTransition('acknowledged', 'in-progress', 'reporter')).toBe(false)
    expect(canTransition('in-progress', 'acknowledged', 'reporter')).toBe(false)
  })

  it('refuses a crew saying the problem is back, which is not theirs to say', () => {
    expect(canTransition('resolved', 'filed', 'crew')).toBe(false)
  })

  it('refuses a transition to the state it is already in', () => {
    for (const kind of ['crew', 'reporter']) {
      for (const id of COMPLAINT_STATUSES.map(s => s.id)) {
        expect(canTransition(id, id, kind)).toBe(false)
      }
    }
  })

  it('survives an unknown state or kind rather than throwing', () => {
    // A record written by an older build, or a hand-edited payload.
    expect(canTransition('nonsense', 'resolved', 'reporter')).toBe(false)
    expect(canTransition('filed', 'resolved', 'nobody')).toBe(false)
    expect(canTransition(undefined, undefined, undefined)).toBe(false)
  })
})

describe('transitionLabel', () => {
  it('names the move in the words of whoever is making it', () => {
    // "It's fixed" and "Job done" are the same transition from two different
    // people, and they are not the same claim, so they do not share a label.
    expect(transitionLabel('reporter', 'filed', 'resolved')).toBe("It's fixed")
    expect(transitionLabel('crew', 'in-progress', 'resolved')).toBe('Job done')
    expect(transitionLabel('crew', 'filed', 'acknowledged')).toBe("We've seen this")
  })

  it('falls back rather than rendering "undefined" for a move with no label', () => {
    expect(transitionLabel('crew', 'filed', 'resolved')).toBe('Update')
    expect(transitionLabel('nobody', 'filed', 'resolved')).toBe('Update')
  })
})

describe('statusClaim — who says so', () => {
  it('attributes a crew move to the crew, and calls the roster what it is', () => {
    const claim = statusClaim({ status: 'in-progress', kind: 'crew', actorName: 'Crew Alpha' })
    expect(claim).toContain('Crew Alpha')
    // There is no WASA/LWMC integration and the roster is a model in this repo,
    // so a crew status can never read as an unqualified municipal record.
    expect(claim).toContain('prototype model')
  })

  it('names no crew when the id is unknown, rather than inventing one', () => {
    const claim = statusClaim({ status: 'acknowledged', kind: 'crew', actorName: null })
    expect(claim).toContain('A crew')
    expect(claim).toContain('prototype model')
  })

  it('attributes a reporter move to the reporter, with no model label', () => {
    // The resident is a real person making a real claim; they are not a model.
    expect(statusClaim({ status: 'resolved', kind: 'reporter' })).toBe('The reporter says it is fixed')
    expect(statusClaim({ status: 'filed', kind: 'reporter' })).toBe('The reporter says it is still happening')
    expect(statusClaim({ status: 'resolved', kind: 'reporter' })).not.toContain('prototype')
  })

  it('returns null for the states that say nothing about who moved them', () => {
    expect(statusClaim({ status: 'filed', kind: 'crew' })).toBeNull()
    expect(statusClaim({ status: 'acknowledged', kind: 'reporter' })).toBeNull()
    expect(statusClaim({ status: 'in-progress', kind: 'reporter' })).toBeNull()
    expect(statusClaim({ status: 'filed', kind: null })).toBeNull()
    expect(statusClaim({})).toBeNull()
  })
})

describe('statusOf', () => {
  it('reads a known status and falls back to filed for anything else', () => {
    expect(statusOf('in-progress').label).toBe('In progress')
    expect(statusOf('resolved').label).toBe('Resolved')
    expect(statusOf('nonsense').id).toBe('filed')
    expect(statusOf(undefined).id).toBe('filed')
    expect(statusOf(null).id).toBe('filed')
  })
})

describe('MAX_STATUS_EVENTS', () => {
  it('is a small number, because it is a per-device queue rather than an archive', () => {
    // The server keeps every event; this is only how many moves one device
    // holds while it waits to send them.
    expect(MAX_STATUS_EVENTS).toBeGreaterThan(0)
    expect(MAX_STATUS_EVENTS).toBeLessThanOrEqual(50)
  })
})
