import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, X, Send, AlertTriangle, MapPin, Video } from 'lucide-react'
import ComplaintCard from './ComplaintCard.jsx'
import { sortComplaints, filterComplaints, SYNC_LOCAL_ONLY, SYNC_PENDING, SYNC_SYNCED, SYNC_ERROR, SORT_RECENT, SORT_CONFIRMED } from '../hooks/useComplaints.js'
import { downscaleImage, validateVideoUrl, validateVideoFile, formatBytes } from '../lib/complaintMedia.js'
import { roundCoordinate, inLahore, LOCATION_PRECISION_M } from '../lib/geo.js'
import {
  COMPLAINT_CATEGORIES, COMPLAINTS_NOTE, STATUS_CLAIM_NOTE,
  MAX_PHOTOS, MAX_BODY_CHARS, MIN_BODY_CHARS, MAX_VIDEO_BYTES,
} from '../data/complaints.js'
import { ZONES } from '../data/lahore.js'

/**
 * Where the board's reports actually live, said plainly — the same four states
 * Field Ops uses for the service log, because it is the same backend and the
 * same question. A count backed by a shared database is a different claim from
 * one held in a single browser, and the screen must not blur the two.
 */
const SYNC_NOTE = {
  [SYNC_LOCAL_ONLY]: 'No shared board is configured — every report below is stored on this device only.',
  [SYNC_PENDING]: 'Connecting to the shared board…',
  [SYNC_SYNCED]: 'Shared board connected — reports filed here are visible to everyone using the app.',
  [SYNC_ERROR]: 'Shared board unreachable — reports are kept on this device and retried. You are seeing only what this device already holds.',
}

const SORTS = [
  { id: SORT_RECENT, label: 'Newest' },
  { id: SORT_CONFIRMED, label: 'Most confirmed' },
]

/**
 * The citizen complaints board.
 *
 * Two panels on one screen — file a report on the left, read everyone's on the
 * right — because they are the same activity seen from two sides, and putting
 * the form behind a button would hide the fact that other people's reports are
 * there at all.
 *
 * Nothing on this page is verified, and it says so once, at the top, rather
 * than hedging on every card. That note is not decoration: every other number
 * in Nigran traces to a paper or a live feed, and this is the one place where
 * that is not true.
 */
export default function ComplaintsView({ board, selectedZone, onNavigate }) {
  const {
    complaints, loaded, sync, file, confirm, setStatus, remove,
    flush, loadPhotos, loadVideo, apiConfigured, durable,
  } = board

  const [category, setCategory] = useState(COMPLAINT_CATEGORIES[0].id)
  // `null` means the citizen has not touched the zone field, which is what lets
  // it follow the zone they are looking at. `''` cannot serve as that sentinel:
  // it is also the value of the "I am not sure which zone" option, so treating
  // it as untouched would silently overrule a citizen who deliberately chose it.
  const [chosenZone, setChosenZone] = useState(null)
  const [body, setBody] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [photos, setPhotos] = useState([])
  const [clip, setClip] = useState(null)
  const [working, setWorking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [photoError, setPhotoError] = useState(null)
  const [clipError, setClipError] = useState(null)
  const [justFiled, setJustFiled] = useState(false)
  const [pin, setPin] = useState(null)
  const [pinMsg, setPinMsg] = useState(null)

  // The zone the citizen is looking at is the zone they are most likely
  // reporting on, so it prefills the field — but the field stays editable, and
  // once they have chosen something their choice wins for good. Derived rather
  // than pushed in by an effect: an effect here would be a second render, and
  // would have to guess whether an empty field meant "untouched" or "no zone".
  const zoneId = chosenZone ?? selectedZone?.id ?? ''

  // Object URLs for the local previews have to be released or they pin their
  // blobs for the life of the document — and a pinned clip blob is 25 MB, so
  // this matters more here than it did for the photos.
  const photosRef = useRef([])
  const clipRef = useRef(null)
  useEffect(() => { photosRef.current = photos }, [photos])
  useEffect(() => { clipRef.current = clip }, [clip])
  useEffect(() => () => {
    for (const photo of photosRef.current) URL.revokeObjectURL(photo.preview)
    if (clipRef.current) URL.revokeObjectURL(clipRef.current.preview)
  }, [])

  const [filterCategory, setFilterCategory] = useState(null)
  const [filterZone, setFilterZone] = useState('')
  const [sort, setSort] = useState(SORT_RECENT)

  const visible = useMemo(
    () => sortComplaints(filterComplaints(complaints, { category: filterCategory, zoneId: filterZone || null }), sort),
    [complaints, filterCategory, filterZone, sort],
  )

  // Only the categories that are actually on the board get a chip. A row of
  // nine filters where seven match nothing is noise, not navigation.
  const presentCategories = useMemo(() => {
    const seen = new Set(complaints.map(c => c.category))
    return COMPLAINT_CATEGORIES.filter(c => seen.has(c.id))
  }, [complaints])

  const presentZones = useMemo(() => {
    const seen = new Set(complaints.map(c => c.zoneId).filter(Boolean))
    return ZONES.filter(z => seen.has(z.id))
  }, [complaints])

  const addPhotos = async (event) => {
    const files = Array.from(event.target.files || [])
    // Cleared immediately so picking the same file twice in a row still fires.
    event.target.value = ''
    if (!files.length) return
    setPhotoError(null)
    setWorking(true)
    const accepted = []
    let failure = null
    for (const picked of files) {
      if (photos.length + accepted.length >= MAX_PHOTOS) {
        failure = `At most ${MAX_PHOTOS} photos per report.`
        break
      }
      const result = await downscaleImage(picked)
      if (!result.ok) {
        // Loud, and naming the file: a photo that silently fails to attach is
        // a report that goes out without its evidence and nobody notices.
        failure = result.error
        continue
      }
      accepted.push({
        key: `${picked.name}-${Date.now()}-${accepted.length}`,
        blob: result.blob,
        preview: URL.createObjectURL(result.blob),
        bytes: result.bytes,
        originalBytes: result.originalBytes,
      })
    }
    setWorking(false)
    if (accepted.length) setPhotos(current => [...current, ...accepted].slice(0, MAX_PHOTOS))
    if (failure) setPhotoError(failure)
  }

  const dropPhoto = (key) => {
    setPhotos(current => {
      const going = current.find(p => p.key === key)
      if (going) URL.revokeObjectURL(going.preview)
      return current.filter(p => p.key !== key)
    })
  }

  /**
   * One clip per report, and picking a bad file never costs the good one.
   *
   * There is no compression step here — see `validateVideoFile` for why there
   * cannot be one — so the only thing this does is check the file against the
   * cap and the container list and say plainly what it found. A refusal leaves
   * an already-chosen clip exactly where it was.
   */
  const addClip = (event) => {
    const picked = event.target.files?.[0]
    // Cleared immediately so picking the same file twice in a row still fires.
    event.target.value = ''
    if (!picked) return
    const result = validateVideoFile(picked)
    if (!result.ok) {
      setClipError(result.error)
      return
    }
    if (clip) URL.revokeObjectURL(clip.preview)
    setClipError(null)
    setClip({
      key: `${picked.name}-${Date.now()}`,
      file: picked,
      preview: URL.createObjectURL(picked),
      bytes: result.bytes,
    })
  }

  const dropClip = () => {
    if (clip) URL.revokeObjectURL(clip.preview)
    setClip(null)
    setClipError(null)
  }

  const reset = () => {
    for (const photo of photos) URL.revokeObjectURL(photo.preview)
    setPhotos([])
    setBody('')
    setVideoUrl('')
    setPhotoError(null)
    dropClip()
    // The pin goes with the report that was filed. Leaving it set would place
    // the next report at the last one's location, which is exactly the kind of
    // silent inaccuracy the rounding exists to avoid.
    setPin(null)
    setPinMsg(null)
  }

  /**
   * Place this report on the map.
   *
   * Opt-in, every time, and never automatic — a person reporting a blocked
   * drain has not agreed to broadcast where they are standing, and a board that
   * pinned them by default would be making that decision for them. Nothing is
   * sent until they press File.
   *
   * The fix is snapped to three decimal places here, in the browser, so the
   * figure shown to them is the figure that will be stored; the server rounds
   * again because it cannot know this ran.
   */
  const locateMe = () => {
    if (!navigator.geolocation) {
      setPinMsg('This device cannot share a location — the report will still carry its zone.')
      return
    }
    setPinMsg('Locating…')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const snapped = {
          lat: roundCoordinate(pos.coords.latitude),
          lng: roundCoordinate(pos.coords.longitude),
        }
        if (!inLahore(snapped)) {
          setPin(null)
          setPinMsg('That fix is outside Lahore, so no pin will be placed — the report will carry its zone instead.')
          return
        }
        setPin(snapped)
        setPinMsg(`Pinned approximately — rounded to about ${LOCATION_PRECISION_M} m, so the pin does not point at your door.`)
      },
      () => {
        setPin(null)
        setPinMsg('Location permission denied — the report still files, without a pin.')
      },
      { timeout: 10000 },
    )
  }

  const submit = async (event) => {
    event.preventDefault()
    const text = body.trim()
    if (text.length < MIN_BODY_CHARS) {
      setFormError(`Say a little more — at least ${MIN_BODY_CHARS} characters, so someone can act on it.`)
      return
    }
    if (text.length > MAX_BODY_CHARS) {
      setFormError(`That is ${text.length} characters; the limit is ${MAX_BODY_CHARS}.`)
      return
    }
    const video = validateVideoUrl(videoUrl)
    if (!video.ok) {
      setFormError(video.error)
      return
    }
    setFormError(null)
    setSubmitting(true)
    await file({
      category,
      zoneId: zoneId || null,
      body: text,
      videoUrl: video.url,
      lat: pin?.lat ?? null,
      lng: pin?.lng ?? null,
      photos: photos.map(p => p.blob),
      video: clip?.file ?? null,
    })
    // Pushed immediately rather than waiting for the minute timer: someone who
    // has just filed a report is the most likely person to look for it on the
    // shared board, and "not there yet" reads as failure.
    if (apiConfigured) await flush()
    setSubmitting(false)
    reset()
    setJustFiled(true)
    setTimeout(() => setJustFiled(false), 6000)
  }

  return (
    <div className="editorial-container py-10">
      <div className="mb-6">
        <p className="editorial-header-num text-2xl heading-split">Complaints <em>— what residents can see</em></p>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Report anything that is wrong on your street — a flooded underpass, a drain nobody has
          cleared, a bin that has not been emptied — and attach photographs of it. You can also read
          and back what your neighbours have reported.
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <AlertTriangle size={13} style={{ flex: 'none', marginTop: 2 }} />
          <span>{COMPLAINTS_NOTE}</span>
        </p>
        <p className="mt-1 text-micro" style={{ color: 'var(--text-muted)' }}>
          {SYNC_NOTE[sync] ?? SYNC_NOTE[SYNC_LOCAL_ONLY]}
          {!durable && ' This browser is not allowing reports to be stored, so they will last only until you close this tab.'}
        </p>
        <p className="mt-1 text-micro" style={{ color: 'var(--text-muted)' }}>
          {STATUS_CLAIM_NOTE}
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.15fr] gap-6 items-start">
        {/* ---------- The form ---------- */}
        <form className="lux-card-glass" onSubmit={submit}>
          <p className="label-eyebrow" style={{ color: 'var(--accent-gold)' }}>
            File a report
          </p>

          <div className="mt-4">
            <label className="label-micro" htmlFor="complaint-category">
              What is it about?
            </label>
            {/* Text only: a native <option> cannot contain an element, so the
                category icon the chips and cards carry is simply absent here
                rather than substituted with an emoji that renders in the
                system's colours. The label names the category on its own. */}
            <select
              id="complaint-category"
              className="field-lux mt-1.5"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {COMPLAINT_CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="mt-4">
            <label className="label-micro" htmlFor="complaint-zone">
              Where is it? <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </label>
            <select
              id="complaint-zone"
              className="field-lux mt-1.5"
              value={zoneId}
              onChange={e => setChosenZone(e.target.value)}
            >
              <option value="">I am not sure which zone</option>
              {ZONES.map(z => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
            <p className="mt-1.5 text-micro" style={{ color: 'var(--text-muted)' }}>
              This puts a count on the city map. It does not change any flood or heat score —
              citizen reports are never mixed into those.
            </p>

            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {pin ? (
                <>
                  <span className="chip-lux" style={{ cursor: 'default', color: 'var(--accent-green-dark)', background: 'var(--accent-green-light)', borderColor: 'var(--border-medium)' }}>
                    <MapPin size={12} aria-hidden="true" />
                    {pin.lat.toFixed(3)}, {pin.lng.toFixed(3)}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setPin(null); setPinMsg(null) }}
                    className="text-micro"
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                  >
                    Remove the pin
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn-lux btn-lux-soft btn-lux-sm"
                  onClick={locateMe}
                >
                  <MapPin size={13} aria-hidden="true" />
                  Use my location
                </button>
              )}
            </div>
            {pinMsg && (
              <p className="mt-1.5 text-micro" style={{ color: 'var(--text-muted)' }} role="status">{pinMsg}</p>
            )}
            {!pinMsg && (
              <p className="mt-1.5 text-micro" style={{ color: 'var(--text-muted)' }}>
                Optional, and only if you press it. A pin is rounded to about {LOCATION_PRECISION_M} m
                before it is stored, so a report shows the street, not the house — and a report with no
                pin simply carries its zone.
              </p>
            )}
          </div>

          <div className="mt-4">
            <label className="label-micro" htmlFor="complaint-body">
              What is happening?
            </label>
            <textarea
              id="complaint-body"
              className="field-lux mt-1.5"
              value={body}
              maxLength={MAX_BODY_CHARS}
              onChange={e => setBody(e.target.value)}
              placeholder="The drain outside the school on Multan Road has been overflowing since Tuesday. The water is standing knee-deep and children are walking through it."
            />
            <p className="mt-1 text-micro" style={{ color: 'var(--text-muted)' }}>
              {body.trim().length}/{MAX_BODY_CHARS} characters
            </p>
          </div>

          <div className="mt-4">
            <p className="label-micro">
              Photographs <span style={{ textTransform: 'none', letterSpacing: 0 }}>(up to {MAX_PHOTOS})</span>
            </p>
            <div className="flex gap-2 mt-2 flex-wrap items-center">
              {photos.map(photo => (
                <div key={photo.key} style={{ position: 'relative', lineHeight: 0 }}>
                  <img
                    src={photo.preview}
                    alt=""
                    style={{ width: 78, height: 78, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border-light)' }}
                  />
                  <button
                    type="button"
                    onClick={() => dropPhoto(photo.key)}
                    aria-label="Remove this photo"
                    style={{
                      position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 999,
                      border: 'none', background: 'var(--cta-bg)', color: 'var(--cta-text)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    }}
                  >
                    <X size={11} />
                  </button>
                  {/* What is actually about to be sent, after compression. */}
                  <span className="block text-micro mt-1" style={{ color: 'var(--text-muted)', lineHeight: 1.2 }}>
                    {formatBytes(photo.bytes)}
                  </span>
                </div>
              ))}

              {photos.length < MAX_PHOTOS && (
                <label
                  className="btn-lux btn-lux-soft btn-lux-sm"
                  style={{ cursor: working ? 'wait' : 'pointer' }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={addPhotos}
                    disabled={working}
                    style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                  />
                  <ImagePlus size={14} />
                  {working ? 'Compressing…' : 'Add photo'}
                </label>
              )}
            </div>
            <p className="mt-2 text-micro" style={{ color: 'var(--text-muted)' }}>
              Photos are shrunk in your browser before sending, which also removes the location
              data your camera embeds in them.
            </p>
            {photoError && <p className="mt-1 text-micro" style={{ color: 'var(--risk-high)' }}>{photoError}</p>}
          </div>

          <div className="mt-4">
            <label className="label-micro" htmlFor="complaint-video">
              Video link <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </label>
            <input
              id="complaint-video"
              type="url"
              className="field-lux mt-1.5"
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
            />

            <div className="flex gap-3 mt-2 flex-wrap items-start">
              {clip ? (
                <>
                  <video
                    src={clip.preview}
                    controls
                    preload="metadata"
                    style={{
                      width: 168, borderRadius: 10, display: 'block',
                      border: '1px solid var(--border-light)', background: '#000',
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <p className="text-micro" style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                      {clip.file.name} · {formatBytes(clip.bytes)}
                    </p>
                    <button
                      type="button"
                      onClick={dropClip}
                      className="text-micro mt-1"
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                    >
                      Remove the clip
                    </button>
                  </div>
                </>
              ) : (
                <label
                  className="btn-lux btn-lux-soft btn-lux-sm"
                >
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.mov,.webm"
                    onChange={addClip}
                    style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                  />
                  <Video size={14} aria-hidden="true" />
                  Attach a short clip
                </label>
              )}
            </div>

            <p className="mt-1.5 text-micro" style={{ color: 'var(--text-muted)' }}>
              A link is the better answer for anything longer than a few seconds — put the clip on
              YouTube, Facebook, Vimeo or Drive and paste the address above. A clip attached here goes
              straight from your phone, capped at {formatBytes(MAX_VIDEO_BYTES)} (roughly twenty
              seconds), and is uploaded behind the report — so a slow upload never costs you the words.
            </p>
            {clipError && <p className="mt-1 text-micro" style={{ color: 'var(--risk-high)' }}>{clipError}</p>}
          </div>

          {formError && (
            <p className="mt-4 text-xs" style={{ color: 'var(--risk-high)' }} role="alert">{formError}</p>
          )}
          {justFiled && (
            <p className="mt-4 text-xs" style={{ color: 'var(--accent-gold-dark)' }} role="status">
              Report filed. It is on the board below.
            </p>
          )}

          <button
            type="submit"
            className="btn-lux mt-5"
            disabled={submitting || working}
          >
            <Send size={14} aria-hidden="true" />
            {submitting ? 'Filing…' : 'File this report'}
          </button>
        </form>

        {/* ---------- The board ---------- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="label-eyebrow" style={{ color: 'var(--accent-gold)' }}>
              The board — {complaints.length} report{complaints.length === 1 ? '' : 's'}
            </p>
            <div className="flex gap-1" role="group" aria-label="Sort reports" style={{ background: 'var(--bg-tertiary)', borderRadius: 999, padding: '0.22rem' }}>
              {SORTS.map(s => {
                const active = sort === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSort(s.id)}
                    aria-pressed={active}
                    className="text-xs font-medium"
                    style={{
                      background: active ? 'var(--accent-gold-light)' : 'transparent',
                      color: active ? 'var(--accent-gold-dark)' : 'var(--text-secondary)',
                      border: '1px solid transparent',
                      borderRadius: 999,
                      padding: '0.35rem 0.9rem',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'background .3s var(--transition-lux), color .3s var(--transition-lux)',
                    }}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>

          {(presentCategories.length > 0 || presentZones.length > 0) && (
            <div className="flex gap-1.5 flex-wrap items-center">
              <button
                type="button"
                className="chip-lux"
                aria-pressed={filterCategory === null}
                onClick={() => setFilterCategory(null)}
              >
                All
              </button>
              {presentCategories.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className="chip-lux"
                  aria-pressed={filterCategory === c.id}
                  onClick={() => setFilterCategory(current => (current === c.id ? null : c.id))}
                >
                  <c.Icon size={13} aria-hidden="true" />
                  {c.label}
                </button>
              ))}
              {presentZones.length > 1 && (
                <select
                  className="field-lux field-lux-sm"
                  aria-label="Filter by zone"
                  value={filterZone}
                  onChange={e => setFilterZone(e.target.value)}
                >
                  <option value="">Every zone</option>
                  {presentZones.map(z => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {!loaded && (
            <div className="lux-card-glass" style={{ textAlign: 'center' }}>
              <div className="lux-spinner" style={{ margin: '0 auto' }} />
              <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>Opening the board…</p>
            </div>
          )}

          {loaded && complaints.length === 0 && (
            <div className="lux-card-glass" style={{ textAlign: 'center' }}>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Nothing reported yet.</p>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                The board is empty. If something on your street is wrong, the form beside this is
                the whole process — no account, no queue, no waiting for approval.
              </p>
            </div>
          )}

          {loaded && complaints.length > 0 && visible.length === 0 && (
            <div className="lux-card-glass" style={{ textAlign: 'center' }}>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                No reports match that filter.
              </p>
              <button
                type="button"
                className="btn-lux btn-lux-outline btn-lux-sm mt-3"
                onClick={() => { setFilterCategory(null); setFilterZone('') }}
              >
                <span>Show everything</span>
              </button>
            </div>
          )}

          {visible.map(complaint => (
            <ComplaintCard
              key={complaint.clientId}
              complaint={complaint}
              isOwn={complaint.isMine}
              apiConfigured={apiConfigured}
              onConfirm={confirm}
              onSetStatus={setStatus}
              onRemove={remove}
              loadPhotos={loadPhotos}
              loadVideo={loadVideo}
            />
          ))}

          {complaints.length > 0 && (
            <button
              type="button"
              className="btn-lux btn-lux-outline btn-lux-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => onNavigate?.('overview')}
            >
              <span>See the counts on the city map →</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
