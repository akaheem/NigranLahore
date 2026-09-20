# Nigran backend

A small Express service over Postgres that keeps two things shared rather than
per-browser:

1. **the drain service record** — so "serviced 4×" means more than one browser's
   private history;
2. **the citizen complaints board** — so a report filed on one phone is visible
   to everyone using the app, with its photographs, its status history and — if
   the reporter attached one — its short video clip.

**The app does not need this.** The risk engine, the fill model, the complaints
board and every data path are client-side, and both features work fully without
a backend — local-only, and the UI says so. With `VITE_API_BASE_URL` unset the
frontend never calls this service and behaves exactly as it did before it
existed. That is the deliberate rollback switch for the live deployment.

## What it is, and what it is not

`POST /api/services`, `POST /api/complaints`, `POST /api/complaints/:id/status`
and `POST /api/complaints/:id/video` require an `x-demo-token` header matching
`DEMO_WRITE_TOKEN`.

**That token is a spam gate, not authentication.** It ships inside the browser
bundle, so anyone who opens devtools can read it. It stops a crawler or a
curious passer-by from filling the tables with junk. It does not stop anyone who
actually wants to.

The protections that matter here are the ones that hold when the token is known
to be readable:

- reads expose drain ids, crew ids, timestamps, complaint text and photo/video
  *ids* — never bytes inline;
- writes are rate-limited per IP: 30/minute for service events, **6/minute for
  complaints**, because a complaint can carry megabytes where an event carries
  a few hundred bytes, and **2/minute for video clips**, because a single one of
  those holds a 33 MB base64 string and a 25 MB buffer in memory at the same
  time. Status moves share the 30/minute ceiling rather than the complaint one,
  because they are a few hundred bytes on the small parser and cannot carry
  image data — charging them against the complaint budget would let a crew
  working through reports spend a citizen's ability to file one;
- every field is validated and length-capped before it reaches SQL;
- `client_event_id` and `client_id` are `UNIQUE`, so a retried write is a no-op
  rather than a duplicate — a flaky connection must not be able to inflate a
  count or post the same complaint twice;
- the token **fails closed**: with `DEMO_WRITE_TOKEN` unset, every write is
  refused rather than every write allowed.

### Complaints carry one thing nothing else in this product does: unverified text

A service event is an operational fact. A complaint is one person's account of
their own street, and the board is the only user-generated content here. Two
rules follow, and both are enforced rather than merely intended:

- **Nothing on the board touches a risk score.** The counts appear on the city
  map and stop there.
- **A video link is re-checked here, and an uploaded clip is typed by its own
  bytes.** The host allowlist runs on both sides, and the protocol check is what
  refuses `javascript:` and `data:` URLs — `new URL()` parses both perfectly
  happily. For an attached clip the caller's declared type is treated as a hint
  at best: `sniffVideoMime` reads the container itself (`ftyp` at offset 4 →
  `video/mp4`; the EBML magic `1A 45 DF A3` → `video/webm`), and only those two
  are storable. That is why an iPhone `.mov` — which the browser calls
  `video/quicktime` while the bytes are ISO-BMFF — is stored as `video/mp4`
  rather than refused, and why a PNG with a video `Content-Type` is not.
- **A status is a claim, and the schema records whose.** `complaint_events`
  stores `actor_kind` (`reporter` | `crew`) alongside every move, so "resolved"
  reached by the resident who filed the report and "resolved" reached by a crew
  are distinguishable rows rather than the same word. The legality table lives
  once, in `parseStatusChange`, and a resident acknowledging their own report is
  refused: that would put a citizen's word in the shape of a municipal response.

Photographs and clips are the two places raw bytes are stored, and both routes
treat them accordingly: the `Content-Type` served is the one **we recorded at
insert time** (already checked against the allowlist *and* against the file's
magic bytes), never anything the caller sends now, and it is paired with
`nosniff`. That is what stops stored bytes being replayed to another browser as
HTML.

**The 25 MB clip cap is a memory cost, stated rather than hidden.** The bytes
live in a `bytea` column, so a request holds the base64 string (~33 MB) and the
decoded buffer (~25 MB) in the Node process at once, and reading one back holds
a buffer of whatever slice was asked for. That is why the parser is 36 MB, why
it is mounted on *only* that route, and why the limiter is 2/minute: this is a
prototype on a small instance, and the honest framing is that a clip costs real
memory rather than that it is free. Anything longer than about twenty seconds
belongs on YouTube with a link, which is what the form tells people.

Ownership is a header, not a session: `x-reporter-id` is a per-device id, and
the delete check is in `mayDelete` with its sibling `mayChangeStatus`. Both stop
the wrong tap and casual tampering. Neither is **access control**, and the UI
never calls it a login.

`mayChangeStatus` checks two different things, and only one of them is a check
at all. A move made as the **reporter** is refused with a 403 unless the
`x-reporter-id` header matches the device that filed the report — that one is
real, in the same sense the delete check is. A move made as a **crew** carries
no such check, because this service has no crew roster: the roster is a
prototype model in the frontend (`src/data/crews.js`), there is no WASA/LWMC
integration behind it, and the server cannot tell one slug from another. So the
crew half of the table is enforced as *shape* — it must be a `crew` move and a
legal one — and not as identity. Anyone who can read the bundle can claim to be
Crew Alpha. That is stated here rather than left for a reader to discover,
because a status that looks like a municipal record is exactly the thing this
product must not fake.

## Routes

| Route | What it does |
|---|---|
| `GET /health` | `{ ok, database, writesEnabled }` — what this instance actually has configured |
| `GET /api/services?drainId=&limit=` | Recent events, newest first |
| `GET /api/services/summary` | Per-drain totals |
| `POST /api/services` | Record one service |
| `GET /api/complaints?zoneId=&limit=&sort=` | The board, newest first (`sort=confirmed` for most-confirmed) |
| `GET /api/complaints/photo/:id` | One photo's bytes, immutable and cacheable for a year |
| `GET /api/complaints/video/:id` | One clip's bytes, with Range support (see below) |
| `POST /api/complaints` | File one complaint, with up to 3 photos as base64, optional `lat`/`lng` |
| `POST /api/complaints/:id/status` | Move a report along its lifecycle — token required |
| `POST /api/complaints/:id/video` | Attach one clip (≤ 25 MB, base64) — token required |
| `POST /api/complaints/:id/confirm` | "Me too" — no token, see below |
| `DELETE /api/complaints/:id` | Remove one, only from the device that filed it |

`GET /api/services/summary` returns, per drain:

```json
{ "drainId": "d1", "count": 4, "simulatedCount": 11, "lastAt": "2026-09-19T10:15:00Z", "lastAtAny": "..." }
```

**`count` excludes `simulated` rows.** A service recorded while the app's clock
was on the 1440× time-lapse is genuinely part of the demo's history — it is kept
and shown — but one afternoon of time-lapse clicking must never be able to read
as years of real maintenance. `simulatedCount` reports those rows separately.

`GET /api/complaints` returns `photoIds` and `videoId` rather than bytes, so a
board load never pulls tens of megabytes through the feed. Each row also carries
its current status with its provenance — `status`, `statusAt`, `statusActor`,
`statusKind` — resolved by a `left join lateral … limit 1` on `complaint_events`.
That lateral is deliberate: joining the events table in the same `FROM` as
`complaint_photos` and `complaint_confirmations` would fan the row out and
inflate the counts, which is the same trap the existing count subqueries avoid.
A lateral subquery with `limit 1` cannot fan out. `confirmations` is counted from
the `complaint_confirmations` table, and `confirmedByMe` is computed from the
`x-reporter-id` header the caller sent — which is why the feed takes that header
at all, and why it is the same header the delete route uses. That same id is
itself the delete credential, since `mayDelete` compares it against `reporter_id`,
so the feed **never returns it**: ownership travels as `isMine`, a boolean
computed server-side against the caller's header. `reporterId` is absent from
every row by design rather than by omission — publishing it would hand any reader
of a public feed the ability to delete anyone's report.

### Range requests on a clip

`GET /api/complaints/video/:id` answers byte ranges, and that is not optional:
Safari sends `Range: bytes=0-1` before it will play anything at all.

| Request | Answer |
|---|---|
| no `Range` | 200, `Accept-Ranges: bytes`, the whole clip |
| `bytes=a-b`, `bytes=a-`, `bytes=-n` | 206, `Content-Range: bytes a-b/total`, `Content-Length` = the **range** length |
| `a >= total` | 416, `Content-Range: bytes */total` |
| malformed, or multiple ranges | 416 |

A multi-range header is refused rather than half-answered: the correct reply is a
`multipart/byteranges` body, and sending only the first range would be a silent
lie about what was served.

The slice is fetched with `substring(bytes from $1 for $2)` against the stored
`byte_size`, so a range request never pulls the whole 25 MB row into Node to
throw most of it away. `substring` is 1-indexed and the offsets are cast to
`::int` explicitly, because `pg` sends untyped parameters and the overload would
otherwise be ambiguous.

Confirming needs no token and is the one deliberate exception: a "me too" should
be frictionless, and the composite primary key on `(complaint_id, device_id)`
means the worst a spammer achieves is one row per device id.

## Configuration

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Absent → every data route answers 503. |
| `DEMO_WRITE_TOKEN` | Shared write token. Absent → all writes refused. |
| `ALLOWED_ORIGINS` | Comma-separated browser origins. Defaults to the two localhost dev ports. |
| `PORT` | Defaults to 3000. |
| `PGSSL` | `verify` re-enables certificate verification (needs the CA installed). |

TLS verification is relaxed for non-localhost hosts by default, because managed
Postgres providers terminate TLS with a certificate Node's default trust store
does not carry. That is a real narrowing — see the comment on `sslConfig` in
`src/db.js`.

## Running it

```bash
cd server
npm install
DATABASE_URL='postgres://…' DEMO_WRITE_TOKEN='pick-something' npm start
```

For local work, `docker compose up -d` starts Postgres 16 on 5432 with the
credentials `.env.example` already points at; copy it to `.env` and use
`npm run start:local`, which reads it through Node's own `--env-file` (there is
no dotenv dependency). `start` and `dev` deliberately do **not** read a file —
on Render the environment arrives from the dashboard, and a missing `.env` there
must not be what breaks a deploy. `docker compose down -v` is the reset.

The schema (`src/schema.sql`) is applied on boot with `CREATE TABLE IF NOT
EXISTS` — enough to stand this up on an empty database. There is no migration
tooling; this is a prototype.

**That has one trap, and it is easy to walk into.** `CREATE TABLE IF NOT EXISTS`
is a silent no-op on a database that already has the table, so a column added to
a `create table` block reaches a fresh database and *never* reaches a running
one — and the symptom is a mystery 500 on an insert, not an error at boot. Every
column added after the fact therefore also carries an explicit

```sql
alter table complaints add column if not exists lat double precision;
```

line next to the table it belongs to. Postgres has supported `ADD COLUMN IF NOT
EXISTS` since 9.6, which keeps the file's "one file, no migration tool" property
intact. `npm run smoke` run against a database created before a column existed
is what proves the alters actually work.

### Body parsers

The three body parsers are mounted **per route, never globally**: 16 kb for the
service log, 4 MB for complaints, and 36 MB for the video route alone (25 MB
× 4/3 for base64, plus slack). A single global parser would take the largest
ceiling for everything and let a 36 MB body be accepted on a route that has no
business seeing one — and would reject a photo-laden request with a 413 before
the complaints route ever saw it. The split is load-bearing, and
`src/validate.test.js` asserts it: the service route still carries the small
parser, the media parser is off it, the 36 MB parser is mounted on the video
route and nowhere else, and no JSON parser is mounted globally.

## Tests

```bash
cd server
npm test
```

Covers the write-path decision logic in `src/validate.js` — the token gate, field
validation, and the coercion that keeps a malformed caller out of SQL, for both
features: that the gate **fails closed** when unconfigured, that a wrong token is
refused, that a complaint's body length is enforced on both ends, that a video
link is re-checked against the allowlist (including a host that merely looks
allowed), that an oversize photo count or a single bad photo refuses the whole
complaint, and that only the filing device may delete. It needs no database and
no dependencies.

The lifecycle and clip parsers are covered the same way, and this is where the
rules are actually pinned rather than in the database: that the transition table
admits exactly the moves in the plan and refuses a resident acknowledging their
own report, that a reporter move from another device is a 403 while a crew move
is not, that a clip's magic bytes decide its type (an `ftyp` box → `video/mp4`,
an EBML header → `video/webm`, a PNG refused), that the base64 length pre-check
rejects an oversize clip *before* decoding it, that an out-of-range coordinate
pair is **dropped rather than the report refused**, and that a `Range` header
becomes the right 206/416 answer with a `Content-Length` for the range rather
than the file.

**Not covered by that suite:** the HTTP wiring and the SQL itself. `npm run
smoke` checks those against a live database — see below.

## Smoke test

```bash
cd server
docker compose up -d
cp .env.example .env
npm run start:local          # in one terminal
npm run smoke                # in another
```

`scripts/smoke.mjs` is the curl sequence below turned into an asserting script
that exits non-zero, so the proof is repeatable instead of being a one-off
session. It covers: `/health`; an untokened write refused and a tokened one
stored; the same `clientEventId` twice being a no-op; a `simulated` row present
in the feed but excluded from `count`; filing a complaint and re-POSTing the
same `clientId`; the feed returning `photoIds`, `confirmations: 0` and the
status fields; a photo coming back with `nosniff` and **bytes identical to what
was sent**; a PNG declared as `image/webp` refused as a mismatch; confirming
twice counting once; a delete from the wrong device refused and from the right
one cascade-deleting the photo; a legal status move accepted, an illegal one
refused with 409, and a reporter move from another device with 403; a clip
uploaded, re-uploaded (a duplicate, not a replacement), fetched whole, fetched
as `bytes=0-1` with a 206 and a range-length `Content-Length`, and requested
past the end for a 416; and an unknown route answering JSON 404 rather than
HTML.

Run it twice: the second run is the idempotency assertion. To prove the
`alter table` lines work, run it once against a database created *before* those
columns existed.

## Deploying to Render

1. **Postgres** — create a Render Postgres instance, then copy its *external*
   connection string.
2. **Web service** — point it at this repository with **root directory
   `server`**, build `npm install`, start `npm start`.
3. Set `DATABASE_URL`, `DEMO_WRITE_TOKEN`, and `ALLOWED_ORIGINS` to the Vercel
   production origin (plus any preview origin you actually use).
4. On the Vercel side set `VITE_API_BASE_URL` to this service's URL and
   `VITE_DEMO_WRITE_TOKEN` to the same token.

## Verifying a deployment

**Prefer `SMOKE_BASE_URL=https://your-service.onrender.com npm run smoke`.** It
is the sequence below as an asserting script — it exits non-zero on a failure
rather than leaving you to read the output, and it covers the status and clip
routes as well. The curl form stays here because sometimes you want to see one
answer with your own eyes.

```bash
BASE=https://your-service.onrender.com
TOKEN=the-token-you-set

# 1. It is up, and it has what it needs
curl -s $BASE/health

# 2. An untokened write is refused
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/services \
  -H 'content-type: application/json' -d '{"drainId":"d1","servicedAt":"2026-09-19T10:00:00Z"}'
# → 401

# 3. A tokened write is stored
curl -s -X POST $BASE/api/services \
  -H 'content-type: application/json' -H "x-demo-token: $TOKEN" \
  -d '{"clientEventId":"curl-check-1","drainId":"d1","servicedAt":"2026-09-19T10:00:00Z","fillAtService":91.4}'

# 4. Sending the SAME clientEventId again inserts nothing (duplicate: true)
curl -s -X POST $BASE/api/services \
  -H 'content-type: application/json' -H "x-demo-token: $TOKEN" \
  -d '{"clientEventId":"curl-check-1","drainId":"d1","servicedAt":"2026-09-19T10:00:00Z","fillAtService":91.4}'

# 5. A simulated write does NOT move the count
curl -s -X POST $BASE/api/services \
  -H 'content-type: application/json' -H "x-demo-token: $TOKEN" \
  -d '{"clientEventId":"curl-check-2","drainId":"d1","servicedAt":"2026-09-19T10:05:00Z","simulated":true,"speed":1440}'

curl -s $BASE/api/services/summary
# → d1 shows count:1, simulatedCount:1

# 6. File a complaint, then find it on the board
curl -s -X POST $BASE/api/complaints \
  -H 'content-type: application/json' -H "x-demo-token: $TOKEN" -H 'x-reporter-id: curl-device' \
  -d '{"clientId":"curl-complaint-1","category":"waterlogging","zoneId":"shahdara","body":"Standing water outside the school since Tuesday."}'

curl -s "$BASE/api/complaints?limit=5" -H 'x-reporter-id: curl-device'

# 7. Confirming twice from one device counts once
curl -s -X POST $BASE/api/complaints/1/confirm \
  -H 'content-type: application/json' -d '{"deviceId":"curl-device"}'
# → { "duplicate": false, "confirmations": 1 }
curl -s -X POST $BASE/api/complaints/1/confirm \
  -H 'content-type: application/json' -d '{"deviceId":"curl-device"}'
# → { "duplicate": true, "confirmations": 1 }

# 8. A different device may NOT delete it — 403, and the complaint is still there
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $BASE/api/complaints/1 \
  -H 'x-reporter-id: someone-else'
# → 403

# 9. A photo comes back as an image, never as HTML
curl -s -D - -o /dev/null $BASE/api/complaints/photo/1 | grep -i 'content-type\|nosniff'

# 10. A crew claims the report; the reporter could not have acknowledged it
curl -s -X POST $BASE/api/complaints/1/status \
  -H 'content-type: application/json' -H "x-demo-token: $TOKEN" \
  -d '{"to":"acknowledged","actorKind":"crew","actorId":"crew-1"}'
# → { "status": "acknowledged", … }
curl -s -X POST $BASE/api/complaints/1/status \
  -H 'content-type: application/json' -H "x-demo-token: $TOKEN" \
  -d '{"to":"acknowledged","actorKind":"reporter","actorId":"someone-else"}'
# → 403 — a reporter move must come from the filing device
curl -s -X POST $BASE/api/complaints/1/status \
  -H 'content-type: application/json' -H "x-demo-token: $TOKEN" \
  -d '{"to":"filed","actorKind":"crew","actorId":"crew-1"}'
# → 409 — a crew cannot un-resolve a report

# 11. A clip, attached after the report
curl -s -X POST $BASE/api/complaints/1/video \
  -H 'content-type: application/json' -H "x-demo-token: $TOKEN" \
  -d "{\"data\":\"$(base64 -w0 clip.mp4)\"}"
# → 201; the same request again → 200 { "duplicate": true } — one clip per report

# 12. Safari's first request, and the end of the file
curl -s -D - -o /dev/null -H 'Range: bytes=0-1' $BASE/api/complaints/video/1 | grep -i 'content-range\|content-length'
# → 206, Content-Range: bytes 0-1/12345, Content-Length: 2
curl -s -o /dev/null -w '%{http_code}\n' -H 'Range: bytes=99999999-' $BASE/api/complaints/video/1
# → 416
```
