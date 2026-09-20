import { useEffect, useMemo, useState } from 'react'
import { ThumbsUp, Trash2, ExternalLink, Clock, Send, Eye, Wrench, CircleCheck, User } from 'lucide-react'
import { categoryOf, statusOf, statusClaim, transitionLabel, TRANSITIONS } from '../data/complaints.js'
import { crewName } from '../data/crews.js'
import { ZONES } from '../data/lahore.js'
import { relativeTime } from '../lib/relativeTime.js'
import { complaintPhotoUrl, complaintVideoUrl } from '../hooks/useComplaints.js'
import MediaLightbox from './MediaLightbox.jsx'

const zoneName = (id) => (id ? ZONES.find(z => z.id === id)?.name ?? id : null)

/**
 * How a status reads at a glance. Tone is not decoration here: `filed` is the
 * quiet default a report sits at until someone acts, `resolved` is the only one
 * that gets the accent, and the two middle states are deliberately the two
 * warning tones rather than shades of green — "acknowledged" is not progress,
 * it is somebody saying they have seen it.
 */
const STATUS_TONE = {
  filed: { color: 'var(--text-muted)', background: 'var(--bg-tertiary)', border: 'var(--border-light)' },
  acknowledged: { color: 'var(--risk-info)', background: '#F5F3FF', border: '#DDD6FE' },
  'in-progress': { color: 'var(--risk-moderate)', background: '#FFFBEB', border: '#FDE68A' },
  resolved: { color: 'var(--accent-green-dark)', background: 'var(--accent-green-light)', border: 'var(--border-medium)' },
}

/**
 * The chip's glyph, from the icon set the rest of the app draws with rather
 * than from the emoji in `COMPLAINT_STATUSES`.
 *
 * The status is the only field here with no `<option>` anywhere — it is never
 * rendered inside a native `<select>` — so it is the one that can be a real
 * icon. A category has to keep its emoji, because `ComplaintsView` renders
 * those inside `<option>` elements, where an SVG cannot go. Replacing the
 * category glyph on the card alone would put one pictogram style in the card
 * and another in the form that files it, which is worse than either.
 */
const STATUS_ICON = {
  filed: Send,
  acknowledged: Eye,
  'in-progress': Wrench,
  resolved: CircleCheck,
}

/**
 * One complaint on the board.
 *
 * Everything here is a citizen's own account, so the card never states anything
 * as fact it cannot back: the age is the age of the *report*, not of the
 * flooding; a photo is captioned by whoever filed it; and a count is called
 * what it is, a count of people who pressed a button.
 *
 * The status is the one thing on this card that reads like an official record,
 * so it is the one that is most carefully attributed: the chip says what state
 * the report is in, the line under it says who claimed that, and a claim made
 * by a crew is labelled a prototype model wherever it appears.
 */
export default function ComplaintCard({
  complaint,
  isOwn = false,
  apiConfigured = false,
  crew = null,
  onConfirm,
  onRemove,
  onSetStatus,
  loadPhotos,
  loadVideo,
}) {
  // Only the media this device holds itself needs state, because only an object
  // URL has a lifetime to manage. `null` means "nothing loaded yet"; see the two
  // derivations below for what is shown instead.
  const [localSources, setLocalSources] = useState(null)
  const [localVideo, setLocalVideo] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const category = categoryOf(complaint.category)
  const localCount = complaint.photoCount || 0
  // Derived from a string so the array identity is stable across the periodic
  // merge. The board hands back a fresh array every pull, and a new identity
  // here would rebuild every board URL on the card once a minute for no reason.
  const remoteKey = (complaint.remotePhotos || []).join(',')
  const remotePhotos = useMemo(() => (remoteKey ? remoteKey.split(',') : []), [remoteKey])

  /**
   * Photographs this device holds are Blobs in IndexedDB; photographs the board
   * holds are ids to fetch.
   *
   * The board's are derived, because a URL is just a string and has nothing to
   * clean up. Only the device's own need an effect, and only they become object
   * URLs — which is what the state above exists for: the lifetime of a URL is
   * tied to the card that made it, and creating one during render would leak a
   * fresh URL on every re-render, continuously on a board that re-renders on a
   * timer.
   *
   * `localSources` is tagged with the complaint it was loaded for. The tag is
   * not decoration: the cleanup below runs before the next effect, so a card
   * that changed complaint holds URLs that have already been revoked until its
   * own load resolves, and the tag is what keeps those off the screen.
   */
  const boardSources = useMemo(
    () => remotePhotos.map(id => ({ src: complaintPhotoUrl(id), remote: true })),
    [remotePhotos],
  )

  useEffect(() => {
    if (!localCount || !loadPhotos) return undefined
    let cancelled = false
    let created = []
    loadPhotos(complaint.clientId).then(blobs => {
      // Checked before anything is created, so a load that lands after the card
      // moved on makes no URL at all rather than one nothing will revoke.
      if (cancelled) return
      created = (blobs || []).filter(b => b?.blob).map(b => URL.createObjectURL(b.blob))
      setLocalSources({ for: complaint.clientId, sources: created.map(src => ({ src, remote: false })) })
    })
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [complaint.clientId, localCount, loadPhotos])

  // This device's own copy wins while it is here: those are the actual files.
  // The board's ids are the fallback for a report this device never filed, or one
  // whose blobs have gone. The two are mutually exclusive by construction —
  // `mergeComplaints` drops the remote ids whenever the local count is non-zero.
  const sources = localSources?.for === complaint.clientId ? localSources.sources : boardSources

  /**
   * The clip filed with this report, from wherever it can actually be played.
   *
   * A clip this device filed is a Blob in IndexedDB and is played from memory —
   * there is no reason to spend a resident's data re-downloading bytes they
   * already hold. Once the device no longer has it (a cleared profile, a
   * different phone) the board's copy is used instead, so the clip is still
   * watchable rather than silently gone.
   *
   * Same split as the photographs above, and for the same reason: the board's
   * URL is derived, and only the local Blob needs an effect, a state slot and a
   * cleanup. Building the object URL in an effect is what keeps its lifetime
   * tied to the card rather than leaking one per render.
   */
  const hasVideo = complaint.hasVideo === true
  const videoId = complaint.videoId ?? null
  const boardVideoSrc = videoId ? complaintVideoUrl(videoId) : null

  useEffect(() => {
    if (!hasVideo || !loadVideo) return undefined
    let cancelled = false
    let created = null
    loadVideo(complaint.clientId).then(blob => {
      // A clip the device no longer holds falls through to the board's copy,
      // and as above, nothing is created for a card that has moved on.
      if (cancelled || !blob) return
      created = URL.createObjectURL(blob)
      setLocalVideo({ for: complaint.clientId, src: created })
    })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [complaint.clientId, hasVideo, loadVideo])

  const videoSrc = localVideo?.for === complaint.clientId ? localVideo.src : boardVideoSrc

  const at = relativeTime(complaint.createdAt)
  const zone = zoneName(complaint.zoneId)
  const confirmations = complaint.confirmations || 0

  const status = statusOf(complaint.status)
  const statusTone = STATUS_TONE[status.id] ?? STATUS_TONE.filed
  const StatusIcon = STATUS_ICON[status.id] ?? Send
  // Who the last move is attributed to. A crew claim is only ever rendered
  // through `statusClaim`, which appends the prototype-model label — so a crew
  // status can never appear as an unqualified municipal record.
  const claim = statusClaim({
    status: status.id,
    kind: complaint.statusKind,
    actorName: complaint.statusKind === 'crew' ? crewName(complaint.statusActor) : null,
  })
  const claimedAt = relativeTime(complaint.statusAt)

  // The moves this viewer may actually make. A crew sees the crew column, the
  // reporter who filed it sees theirs, and nobody else is offered anything —
  // the same table the server enforces, so a button here is never a 409 waiting
  // to happen.
  const moves = crew
    ? (TRANSITIONS.crew[status.id] ?? [])
    : (isOwn ? (TRANSITIONS.reporter[status.id] ?? []) : [])

  // Confirming a report the board has never seen would be a number only this
  // device knows, which would then appear to fall on the next pull.
  const canConfirm = complaint.confirmedByMe || !apiConfigured || Boolean(complaint.remoteId)

  const handleStatus = async (to) => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const actor = crew ? { kind: 'crew', actorId: crew.id } : { kind: 'reporter' }
    const result = await onSetStatus?.(complaint.clientId, to, actor)
    setBusy(false)
    if (result && result.ok === false) {
      setNotice(result.reason === 'stale'
        ? 'Someone else moved this report first, so the board has been re-read and its answer is the one shown.'
        : result.reason === 'not-owner'
          ? 'Only the device that filed this report can say what happened to it.'
          : 'Could not move this report on the shared board.')
    }
  }

  const handleConfirm = async () => {
    if (busy || complaint.confirmedByMe) return
    setBusy(true)
    setNotice(null)
    const result = await onConfirm?.(complaint.clientId)
    setBusy(false)
    if (result && result.ok === false) {
      setNotice(result.reason === 'not-synced'
        ? 'This report has not reached the shared board yet — try again in a moment.'
        : 'Could not reach the shared board, so your count was not recorded.')
    }
  }

  const handleRemove = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const result = await onRemove?.(complaint.clientId)
    setBusy(false)
    // The card is gone on success, so a notice is only ever about a failure.
    if (result && result.ok === false) {
      setNotice(result.reason === 'offline'
        ? 'Could not remove this from the shared board — it has been left in place rather than half-deleted.'
        : 'This complaint cannot be removed from this device.')
    }
  }

  return (
    <article
      className="lux-card-glass complaint-card fade-in-lux"
      style={{ '--status-tone': statusTone.color }}
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Ownership leads, because it is the one fact a reader needs before
              anything else on the card applies to them: every other line here is
              somebody else's account. A neighbour's report carries no badge —
              the absence is the marker, and stamping "not yours" on forty rows
              would be noise rather than information. */}
          {isOwn && (
            <span
              className="label-micro inline-flex items-center gap-1 rounded-full px-2 py-1"
              style={{ color: 'var(--accent-gold-dark)', background: 'var(--accent-gold-light)' }}
            >
              <User size={11} aria-hidden="true" />
              Your report
            </span>
          )}
          {/* The category's icon at label size, in the label's own colour, so the
              two read as one unit. The emoji this replaces was set at text-lg and
              carried its own colours, which made it the loudest thing in a row
              of quiet metadata — and it changed picture depending on which
              operating system drew it. */}
          <category.Icon size={13} aria-hidden="true" style={{ color: 'var(--accent-gold-dark)', flex: 'none' }} />
          <span className="label-micro" style={{ color: 'var(--accent-gold-dark)' }}>
            {category.label}
          </span>
          {zone && (
            <span className="text-micro" style={{ color: 'var(--text-muted)' }}>· {zone}</span>
          )}
          <span
            className="chip-lux"
            style={{
              cursor: 'default',
              color: statusTone.color,
              background: statusTone.background,
              borderColor: statusTone.border,
            }}
          >
            <StatusIcon size={12} aria-hidden="true" />
            {status.label}
          </span>
        </div>
        <span className="flex items-center gap-1 text-micro" style={{ color: 'var(--text-muted)' }}>
          <Clock size={11} aria-hidden="true" />
          {at ?? 'time not recorded'}
        </span>
      </header>

      <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
        {complaint.body}
      </p>

      {sources.length > 0 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {sources.map((photo, index) => (
            <button
              key={photo.src}
              type="button"
              onClick={() => setLightbox(index)}
              aria-label={`Open photo ${index + 1} of ${sources.length}`}
              style={{
                padding: 0,
                border: '1px solid var(--border-light)',
                borderRadius: 10,
                overflow: 'hidden',
                cursor: 'pointer',
                background: 'var(--bg-tertiary)',
                lineHeight: 0,
              }}
            >
              <img
                src={photo.src}
                alt=""
                loading="lazy"
                style={{ width: 108, height: 108, objectFit: 'cover', display: 'block' }}
              />
            </button>
          ))}
        </div>
      )}

      {videoSrc && (
        // The clip the report was filed with, played here rather than linked
        // away: these bytes are either on this device or on the board, and
        // neither is a third party. `preload="metadata"` because a 25 MB clip
        // must not start downloading merely because a card scrolled past.
        <video
          controls
          preload="metadata"
          src={videoSrc}
          className="mt-3"
          style={{
            display: 'block',
            width: '100%',
            maxWidth: 320,
            borderRadius: 10,
            background: '#000',
            border: '1px solid var(--border-light)',
          }}
        >
          Your browser cannot play this clip.
        </video>
      )}

      {complaint.videoPending && (
        <p className="mt-2 text-micro" style={{ color: 'var(--text-muted)' }}>
          The clip has not reached the shared board yet — it uploads behind the report, so the words are already there.
        </p>
      )}

      {complaint.videoError && (
        <p className="mt-2 text-micro" style={{ color: 'var(--risk-high)' }}>{complaint.videoError}</p>
      )}

      {complaint.videoUrl && (
        // An outbound anchor, never an embed. Pulling a third party's frame into
        // a civic page buys nothing here and costs a tracking and script surface.
        <a
          href={complaint.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mt-3 text-xs font-medium"
          style={{ color: 'var(--accent-gold-dark)' }}
        >
          <ExternalLink size={13} />
          Watch the video they linked
        </a>
      )}

      {claim && (
        // Who says so, and when. The chip above states the status; this states
        // its provenance, which is the part that would otherwise be lost — a
        // "Resolved" that came from the resident who filed the report and one
        // that came from a crew are different claims and read differently here.
        <p className="mt-3 text-micro" style={{ color: 'var(--text-muted)' }}>
          {claim}
          {claimedAt && <> · {claimedAt}</>}
        </p>
      )}

      <footer className="flex items-center gap-2 mt-4 flex-wrap">
        <button
          type="button"
          className="chip-lux"
          aria-pressed={complaint.confirmedByMe === true}
          disabled={!canConfirm || busy}
          onClick={handleConfirm}
          title={canConfirm ? 'Add your voice — one per device' : 'This report has not reached the shared board yet'}
        >
          <ThumbsUp size={12} />
          {complaint.confirmedByMe ? 'You confirmed this' : 'Me too'}
          {confirmations > 0 && <strong>· {confirmations}</strong>}
        </button>

        {confirmations > 0 && (
          <span className="text-micro" style={{ color: 'var(--text-muted)' }}>
            {confirmations === 1 ? '1 person reported this' : `${confirmations} people reported this`}
          </span>
        )}

        {moves.map((to) => {
          // The move that says the problem is gone carries the accent; the one
          // that says it is back does not. Colouring "still happening" like
          // progress would be the wrong signal on the most consequential button
          // on the card.
          const forward = to === 'resolved'
          return (
            <button
              key={to}
              type="button"
              className="chip-lux"
              disabled={busy}
              onClick={() => handleStatus(to)}
              style={{
                cursor: busy ? 'wait' : 'pointer',
                color: forward ? 'var(--accent-green-dark)' : 'var(--text-secondary)',
                borderColor: forward ? 'var(--border-medium)' : 'var(--border-light)',
                background: forward ? 'var(--accent-green-light)' : 'transparent',
              }}
            >
              {transitionLabel(crew ? 'crew' : 'reporter', status.id, to)}
            </button>
          )
        })}

        {isOwn && !(apiConfigured && complaint.synced) && (
          // Two different facts, and the gate has to keep them apart. With a
          // board configured, `synced` means "the board has it"; with none, the
          // hook marks every record synced because there is nothing owed to a
          // flush queue — and gating on `synced` alone would then hide this line
          // in exactly the deployment it was written for. It would never say
          // "Saved on this device" anywhere.
          <span className="chip-lux" style={{ cursor: 'default' }}>
            {apiConfigured ? 'Not on the shared board yet' : 'Saved on this device'}
          </span>
        )}

        {isOwn && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="inline-flex items-center gap-1 text-micro ml-auto"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: busy ? 'wait' : 'pointer', padding: 0 }}
          >
            <Trash2 size={12} />
            Remove
          </button>
        )}
      </footer>

      {notice && (
        <p className="mt-2 text-micro" style={{ color: 'var(--risk-high)' }}>{notice}</p>
      )}

      {lightbox != null && (
        <MediaLightbox
          photos={sources.map((photo, index) => ({ src: photo.src, alt: `${category.label} — photo ${index + 1}` }))}
          startIndex={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </article>
  )
}
