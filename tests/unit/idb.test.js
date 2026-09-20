import { describe, it, expect, beforeEach } from 'vitest'
import { createComplaintStore, photoKey } from '../../src/lib/idb.js'

/**
 * jsdom has no IndexedDB, so these all run the store's in-memory path.
 *
 * That is not a workaround for the test — it is the same code path Safari takes
 * in private browsing and a browser with storage blocked, and the whole point
 * of writing the fallback is that it works. What is NOT covered here is the
 * IndexedDB path itself: no test in this suite opens a real database.
 */
describe('createComplaintStore (in-memory fallback)', () => {
  let store

  beforeEach(() => {
    store = createComplaintStore()
  })

  it('reports that records will not survive a reload', async () => {
    const durable = await store.ready
    expect(durable).toBe(false)
    expect(store.durable).toBe(false)
  })

  it('round-trips a complaint', async () => {
    await store.save({ clientId: 'c-1', body: 'a flooded street', category: 'waterlogging' })
    expect(await store.loadAll()).toEqual([
      { clientId: 'c-1', body: 'a flooded street', category: 'waterlogging' },
    ])
  })

  it('refuses a record with no id, which would be unreachable afterwards', async () => {
    expect(await store.save({ body: 'no id' })).toBe(false)
    expect(await store.loadAll()).toEqual([])
  })

  it('overwrites rather than duplicating on the id', async () => {
    await store.save({ clientId: 'c-1', body: 'first' })
    await store.save({ clientId: 'c-1', body: 'second' })
    expect(await store.loadAll()).toHaveLength(1)
    expect((await store.loadAll())[0].body).toBe('second')
  })

  it('keeps a complaint photos in order', async () => {
    const blobs = [new Blob(['a']), new Blob(['b']), new Blob(['c'])]
    for (const [index, blob] of blobs.entries()) await store.savePhoto('c-1', index, blob)
    const loaded = await store.loadPhotos('c-1')
    expect(loaded.map(p => p.index)).toEqual([0, 1, 2])
  })

  it('keys photos so one complaint range-sweeps cleanly', () => {
    expect(photoKey('c-1', 2)).toBe('c-1:2')
  })

  it('does not hand one complaint another complaint photos', async () => {
    // The prefix match is the whole reason photos are keyed `${clientId}:${i}`,
    // and it is also the way it could go wrong — `c-1` must not sweep `c-10`.
    await store.savePhoto('c-1', 0, new Blob(['mine']))
    await store.savePhoto('c-10', 0, new Blob(['theirs']))
    expect(await store.loadPhotos('c-1')).toHaveLength(1)
    expect(await store.loadPhotos('c-10')).toHaveLength(1)
  })

  it('removes a complaint and every photo filed with it', async () => {
    await store.save({ clientId: 'c-1', body: 'x' })
    await store.savePhoto('c-1', 0, new Blob(['a']))
    await store.savePhoto('c-1', 1, new Blob(['b']))
    await store.save({ clientId: 'c-2', body: 'y' })
    await store.savePhoto('c-2', 0, new Blob(['c']))

    await store.remove('c-1')

    expect((await store.loadAll()).map(r => r.clientId)).toEqual(['c-2'])
    expect(await store.loadPhotos('c-1')).toEqual([])
    // …and the neighbour is untouched.
    expect(await store.loadPhotos('c-2')).toHaveLength(1)
  })

  it('removes the clip too, which is the largest thing a complaint owns', async () => {
    // A clip runs to 25 MB, so one orphaned here is the most expensive record
    // this store can leak. `remove` clears the video store as well as the photo
    // store, and nothing else in this suite touches the video store at all —
    // the component tests only mock `loadVideo`.
    await store.save({ clientId: 'c-1', body: 'x' })
    await store.saveVideo('c-1', new Blob(['clip']))
    await store.saveVideo('c-2', new Blob(['theirs']))

    await store.remove('c-1')

    expect(await store.loadVideo('c-1')).toBeNull()
    // …and the neighbour still has his.
    expect(await store.loadVideo('c-2')).not.toBeNull()
  })

  it('returns an empty list rather than throwing when a complaint is unknown', async () => {
    expect(await store.loadPhotos('never-existed')).toEqual([])
    expect(await store.remove('never-existed')).toBe(true)
  })
})
