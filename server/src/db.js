/**
 * Postgres access for the shared service log.
 *
 * The whole server is optional infrastructure: the app is complete without it
 * and behaves identically when it is absent. So a missing DATABASE_URL is not
 * an error state here — it is `hasDatabase === false`, and the routes say so
 * rather than pretending to have written something.
 */

import pg from 'pg'

const { Pool } = pg

const DATABASE_URL = process.env.DATABASE_URL || ''

/**
 * Managed Postgres (Render, Heroku, Neon's non-pooled URL) terminates TLS with
 * a certificate signed by an authority Node's default trust store does not
 * carry, so verification has to be relaxed for those hosts or every connection
 * fails. It is scoped deliberately: a local URL gets no TLS at all, and
 * PGSSL=verify turns verification back on for anyone who has installed the CA.
 */
function sslConfig(url) {
  if (!url || /@(localhost|127\.0\.0\.1|\[::1\])/.test(url)) return undefined
  if (process.env.PGSSL === 'verify') return { rejectUnauthorized: true }
  return { rejectUnauthorized: false }
}

export const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: sslConfig(DATABASE_URL), max: 5 })
  : null

export const hasDatabase = Boolean(pool)

/**
 * Create the table and indexes if they are not there yet. `CREATE TABLE IF NOT
 * EXISTS` is the whole migration story for a prototype — enough to stand the
 * service up on an empty database, and a no-op on every boot after that.
 */
export async function ensureSchema() {
  if (!pool) return
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const path = fileURLToPath(new URL('./schema.sql', import.meta.url))
  await pool.query(await readFile(path, 'utf8'))
}

/**
 * Insert one service event. Idempotent on `client_event_id`: a re-sent event
 * inserts nothing, so a retry after a timeout cannot double-count.
 *
 * Returns the stored row, or **null** when the event was already recorded —
 * `on conflict … do nothing returning *` yields no rows rather than the
 * existing one, and the route reports that as `{ duplicate: true }` with a 200.
 * A duplicate is a success, not an error: it means the client's retry landed.
 *
 * A null `client_event_id` is allowed and never conflicts — Postgres treats
 * NULLs as distinct in a unique index — so a hand-rolled curl POST with no id
 * still records, while every event the app sends is deduplicated.
 */
export async function insertServiceEvent(event) {
  const { rows } = await pool.query(
    `insert into service_events
       (client_event_id, drain_id, crew_id, serviced_at, fill_at_service, simulated, speed)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (client_event_id) do nothing
     returning *`,
    [
      event.clientEventId,
      event.drainId,
      event.crewId,
      event.servicedAt,
      event.fillAtService,
      event.simulated,
      event.speed,
    ],
  )
  return rows[0] ?? null
}

/** Recent events, newest first, optionally narrowed to one drain. */
export async function listServiceEvents({ drainId, limit }) {
  const capped = Math.min(Math.max(Number(limit) || 200, 1), 1000)
  if (drainId) {
    const { rows } = await pool.query(
      `select * from service_events where drain_id = $1 order by serviced_at desc limit $2`,
      [drainId, capped],
    )
    return rows
  }
  const { rows } = await pool.query(
    `select * from service_events order by serviced_at desc limit $1`,
    [capped],
  )
  return rows
}

/**
 * Per-drain totals.
 *
 * `count` is REAL services only — `simulated` rows are counted separately in
 * `simulatedCount` and kept out of the headline figure. That separation is the
 * whole reason the column exists: a time-lapse session is a demonstration, and
 * a demonstration must not be able to inflate a maintenance record.
 */
export async function serviceSummary() {
  const { rows } = await pool.query(
    `select
       drain_id                                              as "drainId",
       count(*) filter (where not simulated)::int            as count,
       count(*) filter (where simulated)::int                as "simulatedCount",
       max(serviced_at) filter (where not simulated)         as "lastAt",
       max(serviced_at)                                      as "lastAtAny"
     from service_events
     group by drain_id
     order by count desc, drain_id`,
  )
  return rows
}

/* ==========================================================================
   Citizen complaints
   ========================================================================== */

/**
 * Store one complaint and its photos, together or not at all.
 *
 * A transaction because a complaint row whose photos silently failed to insert
 * would be a report that looks filed but lost its evidence. `client_id` is
 * UNIQUE, so a retry inserts nothing and reports `duplicate`.
 *
 * Returns `{ id, duplicate }`.
 */
export async function insertComplaint(complaint) {
  const client = await pool.connect()
  try {
    await client.query('begin')

    const { rows } = await client.query(
      `insert into complaints (client_id, reporter_id, category, zone_id, body, video_url, lat, lng, loc_precision_m)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (client_id) do nothing
       returning id`,
      [
        complaint.clientId, complaint.reporterId, complaint.category,
        complaint.zoneId, complaint.body, complaint.videoUrl,
        complaint.lat, complaint.lng, complaint.precisionM,
      ],
    )

    if (!rows.length) {
      // Already recorded. A retry landing on an event the log already holds is
      // the success case, not an error.
      await client.query('rollback')
      return { id: null, duplicate: true }
    }

    const id = rows[0].id
    for (const [index, photo] of complaint.photos.entries()) {
      await client.query(
        `insert into complaint_photos (complaint_id, position, mime, bytes, byte_size)
         values ($1, $2, $3, $4, $5)`,
        [id, index, photo.mime, photo.bytes, photo.byteSize],
      )
    }

    await client.query('commit')
    return { id, duplicate: false }
  } catch (err) {
    try { await client.query('rollback') } catch { /* already rolled back */ }
    throw err
  } finally {
    client.release()
  }
}

/**
 * The board: complaints newest first (or most-confirmed first), WITHOUT any
 * image bytes.
 *
 * The correlated subqueries are deliberate. Joining `complaint_confirmations`
 * and `complaint_photos` in one FROM clause multiplies the rows together, so a
 * complaint with 3 photos and 2 confirmations would count 6 confirmations —
 * silently wrong, and wrong in the direction that inflates the number the whole
 * feature exists to report. Subqueries cannot fan out.
 *
 * `photoIds` is only ids; the bytes are fetched one at a time from their own
 * immutable URL. Returning them here would put megabytes on every feed load.
 *
 * The current status comes from a LATERAL join rather than a fourth correlated
 * subquery. It is one join instead of four (status, when, who, which kind), and
 * it still cannot fan out: the subquery carries `limit 1`, so it contributes at
 * most one row per complaint no matter how many events accumulate. A plain join
 * against `complaint_events` — the obvious way to write this — would return one
 * row per complaint *per event*, which is the same fan-out bug the paragraph
 * above is about, one table over.
 */
export async function listComplaints({ deviceId = null, zoneId = null, limit = 200, sort = 'recent' } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 200, 1), 500)
  const order = sort === 'confirmed'
    ? `(select count(*) from complaint_confirmations k where k.complaint_id = c.id) desc, c.created_at desc`
    : `c.created_at desc`

  const { rows } = await pool.query(
    `select
       c.id,
       c.client_id   as "clientId",
       -- Ownership as a boolean, never the raw id. reporter_id is precisely the
       -- string the delete route compares against x-reporter-id, so returning it
       -- in a public feed would hand every reader the credential to remove
       -- anyone's report. $1 is the caller's own device id, already used below
       -- for confirmedByMe. The "is not null" guard is what keeps this a real
       -- boolean when the header is absent, where "= $1" alone would yield NULL.
       -- No backticks in these comments: this SQL is a JS template literal, and
       -- one would close it mid-statement.
       (c.reporter_id is not null and c.reporter_id = $1) as "isMine",
       c.category,
       c.zone_id     as "zoneId",
       c.body,
       c.video_url   as "videoUrl",
       -- Null on every report filed without a pin, which is most of them. The
       -- map draws a marker only where these are present, and a per-zone count
       -- badge everywhere else — the two are deliberately not merged.
       c.lat,
       c.lng,
       c.loc_precision_m as "locPrecisionM",
       c.created_at  as "createdAt",
       (select count(*) from complaint_confirmations k where k.complaint_id = c.id)::int as confirmations,
       exists(select 1 from complaint_confirmations k
              where k.complaint_id = c.id and k.device_id = $1) as "confirmedByMe",
       coalesce((select array_agg(p.id order by p.position)
                 from complaint_photos p where p.complaint_id = c.id), '{}') as "photoIds",
       -- The id of an attached clip, or null. An id and not a boolean, because
       -- the bytes live at their own URL and this is what a card builds it
       -- from — the same reason photoIds is ids rather than image data.
       (select v.id from video_uploads v where v.complaint_id = c.id) as "videoId",
       -- No events at all means nothing has happened to it since it was filed,
       -- which is what "filed" means. The column is never null.
       coalesce(ev.to_status, 'filed') as status,
       ev.created_at                   as "statusAt",
       ev.actor_kind                   as "statusKind",
       -- Only a crew's id travels, for the same reason isMine above is a
       -- boolean: a reporter's move stores the reporter's OWN device id in
       -- actor_id (mayChangeStatus requires actorId === ownerId), and that id is
       -- the delete credential. The card reads this field only to look up a crew
       -- name when statusKind is 'crew' (ComplaintCard.jsx), so a reporter move
       -- loses nothing by arriving without it.
       case when ev.actor_kind = 'crew' then ev.actor_id end as "statusActor"
     from complaints c
     left join lateral (
       select e.to_status, e.actor_kind, e.actor_id, e.created_at
       from complaint_events e
       where e.complaint_id = c.id
       order by e.created_at desc, e.id desc
       limit 1
     ) ev on true
     where ($2::text is null or c.zone_id = $2)
     order by ${order}
     limit $3`,
    [deviceId, zoneId, capped],
  )
  return rows
}

/** One photo's bytes, by id. The only place image data leaves the database. */
export async function getComplaintPhoto(photoId) {
  const id = Number(photoId)
  if (!Number.isInteger(id) || id <= 0) return null
  const { rows } = await pool.query(
    `select id, mime, bytes, byte_size as "byteSize" from complaint_photos where id = $1`,
    [id],
  )
  return rows[0] ?? null
}

/**
 * Record a "me too". The composite primary key makes a second confirmation from
 * the same device impossible, so this returns `{ duplicate: true }` rather than
 * an error — clicking twice is a no-op, not a failure.
 */
export async function confirmComplaint({ complaintId, deviceId }) {
  const id = Number(complaintId)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'not-found' }

  const exists = await pool.query('select 1 from complaints where id = $1', [id])
  if (!exists.rows.length) return { ok: false, reason: 'not-found' }

  const { rows } = await pool.query(
    `insert into complaint_confirmations (complaint_id, device_id)
     values ($1, $2)
     on conflict (complaint_id, device_id) do nothing
     returning complaint_id`,
    [id, deviceId],
  )
  const { rows: counted } = await pool.query(
    'select count(*)::int as count from complaint_confirmations where complaint_id = $1',
    [id],
  )
  return { ok: true, duplicate: !rows.length, confirmations: counted[0]?.count ?? 0 }
}

/** The device that filed a complaint, so the route can check who may remove it. */
export async function getComplaintOwner(complaintId) {
  const id = Number(complaintId)
  if (!Number.isInteger(id) || id <= 0) return null
  const { rows } = await pool.query('select reporter_id as "reporterId" from complaints where id = $1', [id])
  return rows[0]?.reporterId ?? null
}

/** Delete a complaint. Photos and confirmations go with it, via ON DELETE CASCADE. */
export async function deleteComplaint(complaintId) {
  const id = Number(complaintId)
  if (!Number.isInteger(id) || id <= 0) return false
  const { rowCount } = await pool.query('delete from complaints where id = $1', [id])
  return rowCount > 0
}

/* ==========================================================================
   Attached video clips
   ========================================================================== */

/**
 * Store a report's video clip. One per report, enforced by the UNIQUE on
 * `complaint_id`: a second upload is refused as a duplicate rather than
 * replacing the first, so a retry after a timeout cannot overwrite the clip
 * that actually landed.
 *
 * The complaint is checked first rather than relying on the foreign key. A
 * missing complaint would otherwise raise a constraint violation and surface as
 * a 500, when the honest answer is 404.
 */
export async function insertComplaintVideo({ complaintId, mime, bytes, byteSize }) {
  const id = Number(complaintId)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'not-found' }

  const exists = await pool.query('select 1 from complaints where id = $1', [id])
  if (!exists.rows.length) return { ok: false, reason: 'not-found' }

  const { rows } = await pool.query(
    `insert into video_uploads (complaint_id, mime, bytes, byte_size)
     values ($1, $2, $3, $4)
     on conflict (complaint_id) do nothing
     returning id, mime, byte_size as "byteSize", created_at as "createdAt"`,
    [id, mime, bytes, byteSize],
  )
  if (!rows.length) return { ok: true, duplicate: true }
  return { ok: true, duplicate: false, video: rows[0] }
}

/**
 * A clip's metadata WITHOUT its bytes.
 *
 * The route needs this before it can answer anything: `Content-Range` is
 * `bytes a-b/total`, and a request past the end is a 416 whose only content is
 * `bytes *&#47;total`. Reading 25 MB to learn a number would be absurd.
 */
export async function getComplaintVideoMeta(videoId) {
  const id = Number(videoId)
  if (!Number.isInteger(id) || id <= 0) return null
  const { rows } = await pool.query(
    `select id, mime, byte_size as "byteSize" from video_uploads where id = $1`,
    [id],
  )
  return rows[0] ?? null
}

/**
 * A slice of a clip's bytes, `from` 1-indexed into the `bytea`. Omitting `end`
 * reads to the end of the file, which is how a full download is served without
 * a second round trip to discover its length.
 *
 * The slicing happens in Postgres and that is the point of the function: a
 * ranged read exists so Safari can start playing after a few kilobytes, and
 * pulling 25 MB into the Node process to send the first 2 bytes would defeat
 * the entire exercise.
 */
export async function getComplaintVideoChunk(videoId, from, end = null) {
  const id = Number(videoId)
  if (!Number.isInteger(id) || id <= 0) return null
  const { rows } = end == null
    ? await pool.query(
      `select mime, byte_size as "byteSize", substring(bytes from $2::int) as chunk
       from video_uploads where id = $1`,
      [id, from],
    )
    : await pool.query(
      `select mime, byte_size as "byteSize", substring(bytes from $2::int for $3::int) as chunk
       from video_uploads where id = $1`,
      [id, from, end - from + 1],
    )
  return rows[0] ?? null
}

/**
 * A complaint's owner and its CURRENT status, in one round trip.
 *
 * The status is read here, validated in the route, and then passed back to
 * `insertComplaintEvent` as `from` — see the note there for why it travels
 * back rather than being re-read.
 */
export async function getComplaintForStatus(complaintId) {
  const id = Number(complaintId)
  if (!Number.isInteger(id) || id <= 0) return null
  const { rows } = await pool.query(
    `select
       c.reporter_id as "reporterId",
       coalesce((select e.to_status from complaint_events e
                 where e.complaint_id = c.id
                 order by e.created_at desc, e.id desc limit 1), 'filed') as status
     from complaints c
     where c.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

/** The latest status of a complaint. `filed` when nothing has happened to it. */
async function currentStatus(client, complaintId) {
  const { rows } = await client.query(
    `select to_status as status from complaint_events
     where complaint_id = $1 order by created_at desc, id desc limit 1`,
    [complaintId],
  )
  return rows[0]?.status ?? 'filed'
}

/**
 * Record one status change.
 *
 * `from` is the status the caller validated against, and it is checked again
 * here inside a transaction that first takes a row lock on the complaint. That
 * is what makes this safe against two callers moving the same report at once:
 * without it, both could read `filed`, both could validate a legal
 * `filed -> acknowledged`, and the log would end up holding two such events —
 * an impossible history written by two callers who each checked correctly.
 *
 * Returns `{ ok: true, event }`, or `{ ok: false, reason }` where reason is
 * `not-found`, `stale` (someone else moved it first, carrying the status it is
 * actually in now) or `noop` (it is already where the caller wants it — a
 * success, not an error, exactly as a duplicate service event is).
 */
export async function insertComplaintEvent({ complaintId, from, to, actorKind, actorId, note }) {
  const id = Number(complaintId)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'not-found' }

  const client = await pool.connect()
  try {
    await client.query('begin')

    const exists = await client.query('select 1 from complaints where id = $1 for update', [id])
    if (!exists.rows.length) {
      await client.query('rollback')
      return { ok: false, reason: 'not-found' }
    }

    const current = await currentStatus(client, id)
    if (current === to) {
      // Already there. The caller wanted this state and the report is in it,
      // which is the outcome they asked for — so it is a no-op, not a failure.
      await client.query('rollback')
      return { ok: false, reason: 'noop', current }
    }
    if (current !== from) {
      await client.query('rollback')
      return { ok: false, reason: 'stale', current }
    }

    const { rows } = await client.query(
      `insert into complaint_events (complaint_id, from_status, to_status, actor_kind, actor_id, note)
       values ($1, $2, $3, $4, $5, $6)
       returning id, to_status as "to", actor_kind as "actorKind", actor_id as "actorId",
                 note, created_at as "createdAt"`,
      [id, from, to, actorKind, actorId, note ?? null],
    )

    await client.query('commit')
    return { ok: true, event: rows[0] }
  } catch (err) {
    try { await client.query('rollback') } catch { /* already rolled back */ }
    throw err
  } finally {
    client.release()
  }
}
