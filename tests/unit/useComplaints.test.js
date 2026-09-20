import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  mergeComplaints, sortComplaints, filterComplaints, countByZone, useComplaints,
  SORT_RECENT, SORT_CONFIRMED,
} from '../../src/hooks/useComplaints.js'
import { createComplaintStore } from '../../src/lib/idb.js'

// Wrapped rather than replaced: every test below still gets a real store, and
// this one only counts how often the hook builds one.
vi.mock('../../src/lib/idb.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, createComplaintStore: vi.fn(actual.createComplaintStore) }
})

const local = (over = {}) => ({
  clientId: 'c-1',
  isMine: true,
  category: 'waterlogging',
  zoneId: 'shahdara',
  body: 'The drain outside the school has been overflowing since Tuesday.',
  videoUrl: null,
  createdAt: '2026-09-19T10:00:00.000Z',
  confirmations: 0,
  confirmedByMe: false,
  synced: false,
  remoteId: null,
  photoCount: 2,
  remotePhotos: [],
  ...over,
})

const remote = (over = {}) => ({
  clientId: 'c-1',
  isMine: true,
  category: 'waterlogging',
  zoneId: 'shahdara',
  body: 'The drain outside the school has been overflowing since Tuesday.',
  videoUrl: null,
  createdAt: '2026-09-19T10:00:00.000Z',
  confirmations: 0,
  confirmedByMe: false,
  synced: true,
  remoteId: '77',
  photoCount: 0,
  remotePhotos: ['9', '10'],
  ...over,
})

describe('mergeComplaints', () => {
  it('treats one complaint this device filed and the server returned as ONE row', () => {
    // Matching on clientId is what makes the idempotency key do double duty: a
    // retried POST cannot produce two rows here any more than on the server.
    const merged = mergeComplaints([remote()], [local()])
    expect(merged).toHaveLength(1)
  })

  it('keeps the local photos, which are the real files', () => {
    const [row] = mergeComplaints([remote()], [local()])
    expect(row.photoCount).toBe(2)
    expect(row.remotePhotos).toEqual([])
  })

  it('still fetches from the server when this device holds no photo bytes', () => {
    const [row] = mergeComplaints([remote()], [local({ photoCount: 0 })])
    expect(row.remotePhotos).toEqual(['9', '10'])
  })

  it('takes the confirmation count from the server, which is its authority', () => {
    // Two people confirming at once each see only their own tap otherwise.
    const [row] = mergeComplaints([remote({ confirmations: 4, confirmedByMe: true })], [local({ confirmations: 0 })])
    expect(row.confirmations).toBe(4)
    expect(row.confirmedByMe).toBe(true)
  })

  it('never lets a merge lower a count', () => {
    const [row] = mergeComplaints([remote({ confirmations: 1 })], [local({ confirmations: 3 })])
    expect(row.confirmations).toBe(3)
  })

  it('keeps a complaint the server did not return', () => {
    // Either it has not synced yet, or it has aged past the server's page
    // limit. Dropping it is wrong in both cases.
    const merged = mergeComplaints([remote()], [local(), local({ clientId: 'c-2', synced: false })])
    expect(merged.map(c => c.clientId).sort()).toEqual(['c-1', 'c-2'])
  })

  it('picks up the remote id once a local complaint has synced', () => {
    const [row] = mergeComplaints([remote({ remoteId: '77' })], [local({ remoteId: null, synced: false })])
    expect(row.remoteId).toBe('77')
    expect(row.synced).toBe(true)
  })

  it('survives an empty side, which is the first paint', () => {
    expect(mergeComplaints([], [local()])).toHaveLength(1)
    expect(mergeComplaints([remote()], [])).toHaveLength(1)
    expect(mergeComplaints()).toHaveLength(0)
  })
})

/**
 * The one field in that merge where every other rule is wrong.
 *
 * `confirmations` has an owner, the photo bytes have an owner — but a status is
 * a timestamped fact, and a device that moved a report while the board was
 * unreachable is stating something true. So the timestamps decide, and the
 * server only breaks a tie.
 */
describe('mergeComplaints — a status is settled by its timestamp', () => {
  const status = (over = {}) => ({
    status: 'filed', statusAt: null, statusKind: null, statusActor: null, events: [], ...over,
  })

  it('keeps a move this device made while the board was unreachable', () => {
    // "Server wins" would silently discard the resident's tap, which is the
    // same mistake as dropping an unsynced report.
    const [row] = mergeComplaints(
      [remote(status({ status: 'acknowledged', statusAt: '2026-09-19T10:05:00.000Z', statusKind: 'crew', statusActor: 'crew-1' }))],
      [local(status({ status: 'resolved', statusAt: '2026-09-19T10:20:00.000Z', statusKind: 'reporter', statusActor: 'r-me' }))],
    )
    expect(row.status).toBe('resolved')
    expect(row.statusKind).toBe('reporter')
    expect(row.statusActor).toBe('r-me')
    expect(row.statusAt).toBe('2026-09-19T10:20:00.000Z')
  })

  it('keeps the board move when that is the later one', () => {
    // "Local wins" would resurrect a status set from a stale copy and overwrite
    // a crew that moved the report a minute ago.
    const [row] = mergeComplaints(
      [remote(status({ status: 'resolved', statusAt: '2026-09-19T10:30:00.000Z', statusKind: 'crew', statusActor: 'crew-1' }))],
      [local(status({ status: 'in-progress', statusAt: '2026-09-19T10:10:00.000Z', statusKind: 'crew', statusActor: 'crew-1' }))],
    )
    expect(row.status).toBe('resolved')
    expect(row.statusKind).toBe('crew')
  })

  it('gives a tie to the board, which is the shared record', () => {
    const at = '2026-09-19T10:00:00.000Z'
    const [row] = mergeComplaints(
      [remote(status({ status: 'in-progress', statusAt: at, statusKind: 'crew', statusActor: 'crew-1' }))],
      [local(status({ status: 'resolved', statusAt: at, statusKind: 'reporter', statusActor: 'r-me' }))],
    )
    expect(row.status).toBe('in-progress')
    expect(row.statusKind).toBe('crew')
  })

  it('reads an un-timestamped status as the board filed state', () => {
    // Neither side has a timestamp: a report nothing has happened to yet. The
    // server's value is the authority, and its absence means "filed".
    const [row] = mergeComplaints([remote(status())], [local(status())])
    expect(row.status).toBe('filed')
    expect(row.statusAt).toBeNull()
  })

  it('never takes the pending event queue from the server', () => {
    // That list is the moves this device still owes the board, so it is the one
    // thing in the record the server cannot be right about.
    const pending = [{ to: 'resolved', at: '2026-09-19T10:20:00.000Z', kind: 'reporter', actorId: 'r-me', synced: false }]
    const [row] = mergeComplaints(
      [remote(status({ events: [{ to: 'acknowledged', synced: true }] }))],
      [local(status({ status: 'resolved', statusAt: '2026-09-19T10:20:00.000Z', events: pending }))],
    )
    expect(row.events).toEqual(pending)
  })

  it('keeps the pin and the clip flags through a merge', () => {
    // Neither is a contest — one side has it or the other does — so both must
    // survive being merged rather than being overwritten by an absent value.
    const [row] = mergeComplaints(
      [remote(status({ videoId: '5', hasVideo: false }))],
      [local(status({ lat: 31.52, lng: 74.358, locationPrecisionM: 111, hasVideo: true, videoPending: true }))],
    )
    expect(row.lat).toBe(31.52)
    expect(row.lng).toBe(74.358)
    expect(row.locationPrecisionM).toBe(111)
    expect(row.hasVideo).toBe(true)
    expect(row.videoId).toBe('5')
  })

  it('takes the pending flag from this device, never from the board', () => {
    // "Pending" means the bytes are HERE and not there, so only this device can
    // answer it. A server value would be a claim about somebody else's disk.
    const [row] = mergeComplaints(
      [remote(status({ videoId: '5', hasVideo: true, videoPending: true }))],
      [local(status({ hasVideo: true, videoPending: false, videoId: '5' }))],
    )
    expect(row.videoPending).toBe(false)
    expect(row.videoId).toBe('5')
  })
})

describe('sortComplaints', () => {
  const a = { clientId: 'a', createdAt: '2026-09-19T10:00:00.000Z', confirmations: 1 }
  const b = { clientId: 'b', createdAt: '2026-09-19T12:00:00.000Z', confirmations: 5 }
  const c = { clientId: 'c', createdAt: '2026-09-19T11:00:00.000Z', confirmations: 1 }

  it('defaults to newest first', () => {
    expect(sortComplaints([a, b, c]).map(x => x.clientId)).toEqual(['b', 'c', 'a'])
    expect(sortComplaints([a, b, c], SORT_RECENT).map(x => x.clientId)).toEqual(['b', 'c', 'a'])
  })

  it('sorts by confirmations, newest as the tie-break', () => {
    expect(sortComplaints([a, b, c], SORT_CONFIRMED).map(x => x.clientId)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate what it was given', () => {
    const rows = [a, b, c]
    sortComplaints(rows, SORT_CONFIRMED)
    expect(rows.map(x => x.clientId)).toEqual(['a', 'b', 'c'])
  })

  it('does not let an unparseable date reorder the board at random', () => {
    const broken = { clientId: 'x', createdAt: null, confirmations: 0 }
    expect(sortComplaints([a, broken]).map(x => x.clientId)).toEqual(['a', 'x'])
  })
})

describe('filterComplaints', () => {
  const rows = [
    { clientId: 'a', category: 'waterlogging', zoneId: 'shahdara' },
    { clientId: 'b', category: 'waste', zoneId: 'shahdara' },
    { clientId: 'c', category: 'waste', zoneId: null },
  ]

  it('passes everything through with no filter', () => {
    expect(filterComplaints(rows)).toHaveLength(3)
  })

  it('narrows by category and by zone, and by both together', () => {
    expect(filterComplaints(rows, { category: 'waste' }).map(r => r.clientId)).toEqual(['b', 'c'])
    expect(filterComplaints(rows, { zoneId: 'shahdara' }).map(r => r.clientId)).toEqual(['a', 'b'])
    expect(filterComplaints(rows, { category: 'waste', zoneId: 'shahdara' }).map(r => r.clientId)).toEqual(['b'])
  })

  it('leaves out a complaint with no zone when a zone is asked for', () => {
    expect(filterComplaints(rows, { zoneId: 'shahdara' })).not.toContainEqual(rows[2])
  })
})

describe('countByZone', () => {
  it('counts what is on the board, and only that', () => {
    expect(countByZone([
      { zoneId: 'shahdara' }, { zoneId: 'shahdara' }, { zoneId: 'gulberg' }, { zoneId: null },
    ])).toEqual({ shahdara: 2, gulberg: 1 })
  })

  it('returns nothing rather than zeroes for an empty board', () => {
    // A zone with no key renders no count; a zone with 0 would render "0
    // reports" on every zone of the city on first load.
    expect(countByZone([])).toEqual({})
    expect(countByZone()).toEqual({})
  })
})

describe('useComplaints — a report filed is visible to the rest of the hook at once', () => {
  it('lets the next call act on a report that was filed a line earlier', async () => {
    // The submit handler files a report and flushes it to the shared board in
    // the same breath, without waiting for a re-render. So the hook's own view
    // of the board has to include the new report the moment `file` resolves —
    // not one render later. Both calls sit inside ONE act() on purpose: that is
    // the window in which the state-mirroring effect has not yet run, and it is
    // exactly the window the submit handler works in.
    const { result } = renderHook(() => useComplaints())

    let filed
    let confirmed
    await act(async () => {
      filed = await result.current.file({
        category: 'drainage',
        body: 'Blocked drain outside the school, water standing since Tuesday.',
        zoneId: 'shahdara',
      })
      // `confirm` resolves the complaint out of the hook's own list. If that
      // list were only updated through the effect, this would come back
      // `missing` — and in the real app the equivalent call is `flush`, which
      // would silently leave the report for the next 60-second pull.
      confirmed = await result.current.confirm(filed.clientId)
    })

    expect(filed.clientId).toMatch(/^c-/)
    expect(confirmed.ok).toBe(true)
    expect(result.current.complaints.map(c => c.clientId)).toContain(filed.clientId)
  })
})

describe('useComplaints — one store for the hook’s lifetime', () => {
  it('does not build a second store when the hook re-renders', () => {
    // The store holds this device's records and an IndexedDB handle. Two of them
    // would mean a write landing in one and a read coming from the other, so the
    // hook builds exactly one and keeps it. Asserted as "no more calls on
    // re-render" rather than "exactly one call", because how many times React
    // invokes the initializer on MOUNT is React's business and varies with
    // StrictMode — the invariant is that a re-render is not a second store.
    const { rerender } = renderHook(() => useComplaints())
    const onMount = createComplaintStore.mock.calls.length
    expect(onMount).toBeGreaterThan(0)

    rerender()
    rerender()

    expect(createComplaintStore).toHaveBeenCalledTimes(onMount)
  })
})
