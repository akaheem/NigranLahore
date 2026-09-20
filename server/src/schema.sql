-- The shared service log.
--
-- ## How this file is applied, and the rule that follows from it
--
-- `ensureSchema()` (db.js) runs this file verbatim on every boot. That makes
-- `create table if not exists` the whole migration story — no migration tool,
-- no version table — but it has one sharp edge worth stating plainly, because
-- it fails silently rather than loudly:
--
--   `create table if not exists` is a NO-OP on a database that already has the
--   table. Editing a `create table` statement therefore does NOTHING to an
--   existing database. A column added that way exists on a fresh instance and
--   is missing on every instance that has been running, and the symptom is a
--   mysterious 500 in one environment only.
--
-- So: every column added after a table has shipped must also carry an
-- `alter table … add column if not exists …` statement here. Those are cheap,
-- idempotent, and they are what actually bring a running database forward.
--
-- One row per service event, never one row per drain: the count of how many
-- times a drain has been cleared is the point of the feature, and a counter
-- column would lose the record of when and by whom.
--
-- `simulated` marks an event recorded while the app's clock was on the
-- time-lapse. Those rows are kept — the demo's history is real history of the
-- demo — but they are excluded from every published count, so one afternoon of
-- 1440x clicking can never read as years of maintenance.
--
-- `client_event_id` is UNIQUE and comes from the browser. That is what makes a
-- retry safe: a POST that timed out and is sent again inserts nothing the
-- second time, so a flaky connection cannot double-count a service.

create table if not exists service_events (
  id              bigserial primary key,
  client_event_id text        unique,
  drain_id        text        not null,
  crew_id         text,
  serviced_at     timestamptz not null,
  fill_at_service numeric,
  simulated       boolean     not null default false,
  speed           integer,
  created_at      timestamptz not null default now()
);

-- The two reads this table serves: one drain's history, newest first.
create index if not exists service_events_drain_idx
  on service_events (drain_id, serviced_at desc);

-- …and the whole log, newest first, for the browser's initial pull.
create index if not exists service_events_recent_idx
  on service_events (serviced_at desc);


-- Citizen complaints — the board where residents report what they can see.
--
-- This is the only USER-GENERATED content the service stores, and the only
-- signal in the product that nobody has verified. Nothing here may be mixed
-- into a risk score: every other number in the app traces to a paper or a live
-- feed, and a complaint is one person's account of their own street.

create table if not exists complaints (
  id          bigserial primary key,
  -- From the browser, UNIQUE, exactly as service_events.client_event_id is:
  -- a POST that timed out and is retried inserts nothing the second time, so a
  -- flaky connection cannot post the same complaint twice.
  client_id   text        unique,
  -- A per-device id, not an account. It is what lets a device remove what it
  -- filed. It is forgeable and is NOT access control — see server/README.md.
  reporter_id text        not null,
  category    text        not null,
  zone_id     text,
  body        text        not null,
  -- A LINK, never uploaded bytes. Validated against a host allowlist on the way
  -- in, and only ever rendered as an outbound anchor.
  video_url   text,
  -- Where the reporter pinned it, when they chose to. Rounded to three decimal
  -- places on the way in (~110 m) so a published pin cannot be a doorstep;
  -- `loc_precision_m` is what that rounding is worth, and it is stored rather
  -- than assumed so the map can draw an honest accuracy ring instead of
  -- implying the pin is exact. NULL is the normal case: pinning is opt-in.
  lat             double precision,
  lng             double precision,
  loc_precision_m integer,
  created_at  timestamptz not null default now()
);

-- The columns above were added after `complaints` had already shipped, so they
-- MUST also appear here. `create table if not exists` is a no-op on a database
-- that already has the table (see the note at the top of this file), which means
-- editing the statement above does nothing to a running instance — only these
-- do. They are idempotent, so they run harmlessly on a fresh database too.
alter table complaints add column if not exists lat             double precision;
alter table complaints add column if not exists lng             double precision;
alter table complaints add column if not exists loc_precision_m integer;

create index if not exists complaints_recent_idx
  on complaints (created_at desc);

create index if not exists complaints_zone_idx
  on complaints (zone_id);

-- Partial, because only a minority of reports are pinned and the map only ever
-- asks for the ones that are. Indexing the null latitudes too would be dead
-- weight in the index for the common case.
create index if not exists complaints_geo_idx
  on complaints (lat, lng) where lat is not null and lng is not null;

-- Photos live in their own table so the list query never touches a blob.
-- Selecting `complaints` alone would otherwise drag megabytes per row through
-- every feed load.
create table if not exists complaint_photos (
  id           bigserial primary key,
  complaint_id bigint  not null references complaints(id) on delete cascade,
  position     integer not null,
  -- Constrained to the allowlist at the database level as well as in the
  -- route, so a row cannot exist with a type we would refuse to serve.
  mime         text    not null check (mime in ('image/webp', 'image/jpeg', 'image/png')),
  bytes        bytea   not null,
  byte_size    integer not null,
  created_at   timestamptz not null default now(),
  unique (complaint_id, position)
);

create index if not exists complaint_photos_complaint_idx
  on complaint_photos (complaint_id, position);

-- An attached video clip, when the reporter had one short enough to upload.
--
-- `complaint_id` is UNIQUE: one clip per report, and the second upload for the
-- same report is refused rather than queued. The alternative — several clips
-- per report — buys nothing here and multiplies the worst case, which is what
-- this table's cost actually is.
--
-- COST, stated rather than buried: a row can hold 25 MB, and Postgres keeps a
-- `bytea` inside the row (TOASTed out of line above ~2 kB, but still in the
-- same table). A GET of the whole thing pulls 25 MB into the Node process
-- before it is written to the socket, which is why that route supports Range
-- and why uploads are limited to two a minute. This is a deliberate trade for a
-- prototype, not a design that would survive an unkind amount of traffic — see
-- server/README.md.
create table if not exists video_uploads (
  id           bigserial primary key,
  complaint_id bigint  not null unique references complaints(id) on delete cascade,
  -- Constrained at the database level as well as in the route, so a row cannot
  -- exist with a type we would refuse to serve.
  mime         text    not null check (mime in ('video/mp4', 'video/webm')),
  bytes        bytea   not null,
  byte_size    integer not null,
  created_at   timestamptz not null default now()
);

-- "Me too". The composite primary key is the whole point: confirming twice
-- from one device is impossible at the database level, not merely discouraged
-- in the browser. A double-tap is a no-op, and the count cannot be inflated by
-- clicking harder.
create table if not exists complaint_confirmations (
  complaint_id bigint      not null references complaints(id) on delete cascade,
  device_id    text        not null,
  created_at   timestamptz not null default now(),
  primary key (complaint_id, device_id)
);


-- What happened to a report after it was filed.
--
-- An event log rather than a `status` column on `complaints`, for the same
-- reason service_events is a log rather than a counter on each drain: a column
-- would lose when a state was entered and by whom, and those two facts are the
-- entire content of a claim like "in progress". The current status is the
-- newest row here; no rows at all means `filed`.
--
-- `actor_kind` distinguishes the two parties because they are claiming
-- different things and the UI must render them differently: a crew claims
-- work ("we are on it"), a reporter claims observation ("it is fixed"). A
-- single status value with one actor id would flatten "resolved by the
-- reporter" and "resolved by Crew Alpha" into the same statement, and they are
-- not the same statement.
create table if not exists complaint_events (
  id           bigserial primary key,
  complaint_id bigint      not null references complaints(id) on delete cascade,
  from_status  text        not null,
  to_status    text        not null,
  -- Constrained here as well as in the route, so a row cannot exist with an
  -- actor we would refuse to render.
  actor_kind   text        not null check (actor_kind in ('reporter', 'crew')),
  -- A per-device id for a reporter, a crew id for a crew. Both forgeable; see
  -- mayChangeStatus in validate.js for what this check does and does not mean.
  actor_id     text        not null,
  note         text,
  created_at   timestamptz not null default now()
);

-- The read is always "the newest event for this complaint", so the index
-- carries the ordering rather than leaving it to a sort.
create index if not exists complaint_events_complaint_idx
  on complaint_events (complaint_id, created_at desc, id desc);
