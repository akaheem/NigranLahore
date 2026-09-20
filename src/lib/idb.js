/**
 * Local storage for complaints, including their photo blobs.
 *
 * Why not localStorage, which every other piece of persisted state in this app
 * uses? Because of the photos. localStorage holds strings only, so a blob has to
 * be base64-encoded (+33%) and the whole origin shares a ~5MB quota — one photo
 * would fill it. IndexedDB stores Blobs natively and is measured in hundreds of
 * megabytes, which is the right tool for this and the wrong tool for a 200-byte
 * service event. The service log therefore stays on localStorage; complaints
 * live here.
 *
 * When IndexedDB is unavailable the store degrades to an in-memory Map instead
 * of throwing. That is not a test-only path: it is exactly what Safari does in
 * private browsing and what a locked-down browser profile does. The trade is
 * that records last only for the session, which the hook surfaces rather than
 * hides.
 *
 * Nothing here may throw into a render. Every method resolves, and a failure
 * means "this did not persist", never "the app broke".
 */

const DB_NAME = 'nigran-complaints'
// 2 since video clips were added. An IndexedDB version bump is the whole
// migration: `onupgradeneeded` runs on an existing database and creates only
// the stores that are missing, so a browser holding version 1 keeps every
// complaint and photo it had.
const DB_VERSION = 2
const COMPLAINTS = 'complaints'
/** Photos are separated so listing complaints never reads a single blob. */
const PHOTOS = 'photos'
/**
 * Clips get their own store rather than sharing the photo store, because a
 * photo is addressed by an index and a clip is not — one per complaint. Mixing
 * them would mean every read of a complaint's photos had to filter the clip
 * back out, and the one that forgot would try to render a 25 MB video into an
 * `<img>`.
 */
const VIDEOS = 'videos'

/** `${clientId}:${index}` — the key shape for the photo store. */
export const photoKey = (clientId, index) => `${clientId}:${index}`

/** `${clientId}:video` — one clip per complaint, and never more. */
export const videoKey = (clientId) => `${clientId}:video`

function openDb() {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null)
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(COMPLAINTS)) {
          db.createObjectStore(COMPLAINTS, { keyPath: 'clientId' })
        }
        if (!db.objectStoreNames.contains(PHOTOS)) {
          // Keyed by clientId so every photo of one complaint shares a prefix
          // and can be swept in one range delete when the complaint goes.
          db.createObjectStore(PHOTOS, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(VIDEOS)) {
          db.createObjectStore(VIDEOS, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** Run one transaction and resolve with its result, or null on any failure. */
function tx(db, storeName, mode, work) {
  return new Promise(resolve => {
    try {
      const transaction = db.transaction(storeName, mode)
      const store = transaction.objectStore(storeName)
      let result
      const out = work(store)
      if (out && typeof out.then === 'function') {
        out.then(v => { result = v }).catch(() => { result = null })
      } else {
        out.onsuccess = () => { result = out.result }
        out.onerror = () => { result = null }
      }
      transaction.oncomplete = () => resolve(result ?? null)
      transaction.onerror = () => resolve(null)
      transaction.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/**
 * The complaint store. `memory` is the fallback and is always present, so the
 * code paths below have one shape regardless of which backend is live.
 */
export function createComplaintStore() {
  const memory = { complaints: new Map(), photos: new Map(), videos: new Map() }
  let db = null
  let durable = false

  const ready = openDb().then(opened => {
    db = opened
    durable = Boolean(opened)
    return durable
  })

  return {
    /** Resolves true when records will survive a reload. */
    ready,
    get durable() { return durable },
    _memory: memory,

    async loadAll() {
      await ready
      if (!db) return [...memory.complaints.values()]
      const rows = await tx(db, COMPLAINTS, 'readonly', store => store.getAll())
      return Array.isArray(rows) ? rows.filter(Boolean) : []
    },

    async save(record) {
      await ready
      if (!record?.clientId) return false
      memory.complaints.set(record.clientId, record)
      if (!db) return true
      await tx(db, COMPLAINTS, 'readwrite', store => store.put(record))
      return true
    },

    /** Remove a complaint and everything filed with it — photos and clip alike. */
    async remove(clientId) {
      await ready
      if (!clientId) return false
      memory.complaints.delete(clientId)
      for (const key of [...memory.photos.keys()]) {
        if (key.startsWith(`${clientId}:`)) memory.photos.delete(key)
      }
      memory.videos.delete(videoKey(clientId))
      if (!db) return true
      await tx(db, COMPLAINTS, 'readwrite', store => store.delete(clientId))
      // Photos are keyed `${clientId}:${i}`, so one range sweeps them all. The
      // range end appends ￿, which sorts after any index suffix.
      await tx(db, PHOTOS, 'readwrite', store =>
        store.delete(IDBKeyRange.bound(`${clientId}:`, `${clientId}:￿`)))
      await tx(db, VIDEOS, 'readwrite', store => store.delete(videoKey(clientId)))
      return true
    },

    async savePhoto(clientId, index, blob) {
      await ready
      if (!clientId || !blob) return false
      const key = photoKey(clientId, index)
      memory.photos.set(key, blob)
      if (!db) return true
      await tx(db, PHOTOS, 'readwrite', store => store.put({ key, clientId, index, blob }))
      return true
    },

    /**
     * A complaint's photos, ordered by index. Returns [] rather than throwing
     * when a photo has gone missing, so a card can render its text without its
     * images instead of failing outright.
     */
    async loadPhotos(clientId) {
      await ready
      if (!clientId) return []
      if (!db) {
        return [...memory.photos.entries()]
          .filter(([key]) => key.startsWith(`${clientId}:`))
          .map(([key, blob]) => ({ index: Number(key.split(':')[1]) || 0, blob }))
          .sort((a, b) => a.index - b.index)
      }
      const rows = await tx(db, PHOTOS, 'readonly', store =>
        store.getAll(IDBKeyRange.bound(`${clientId}:`, `${clientId}:￿`)))
      if (!Array.isArray(rows)) return []
      return rows
        .filter(r => r && r.blob)
        .map(r => ({ index: Number(r.index) || 0, blob: r.blob }))
        .sort((a, b) => a.index - b.index)
    },

    /**
     * Keep the clip filed with a complaint. One per complaint — a second call
     * replaces the first, because by the time this is called the upload has
     * been accepted and the newer bytes are the ones the board has.
     */
    async saveVideo(clientId, blob) {
      await ready
      if (!clientId || !blob) return false
      memory.videos.set(videoKey(clientId), blob)
      if (!db) return true
      await tx(db, VIDEOS, 'readwrite', store => store.put({ key: videoKey(clientId), clientId, blob }))
      return true
    },

    /** A complaint's clip, or null when it has none. */
    async loadVideo(clientId) {
      await ready
      if (!clientId) return null
      if (!db) return memory.videos.get(videoKey(clientId)) ?? null
      const row = await tx(db, VIDEOS, 'readonly', store => store.get(videoKey(clientId)))
      return row?.blob ?? null
    },
  }
}
