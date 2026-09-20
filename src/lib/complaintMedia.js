/**
 * Photo and video handling for the complaints board.
 *
 * The pure parts live at the top and are unit-tested directly. The browser-only
 * part (`downscaleImage`) takes its canvas/image dependencies as an argument so
 * a test can drive it with fakes without a real canvas — jsdom has none.
 */

import {
  MAX_PHOTO_BYTES, VIDEO_HOSTS,
  MAX_VIDEO_BYTES, VIDEO_FILE_EXTENSIONS, VIDEO_FILE_MIMES,
} from '../data/complaints.js'

/** Longest edge, in pixels, of a stored photo. */
export const MAX_PHOTO_EDGE = 1400
/** WebP quality. 0.82 is the point where a street photo stays legible and small. */
export const PHOTO_QUALITY = 0.82

/**
 * Scale `width`x`height` down so neither edge exceeds `maxEdge`, preserving
 * aspect ratio. Never scales UP — a small photo stays its own size rather than
 * being interpolated into a blurry bigger one.
 *
 * Returns `null` for dimensions that are not usable positive numbers, so a
 * caller can report a decode failure instead of drawing a 0x0 canvas.
 */
export function fitWithin(width, height, maxEdge = MAX_PHOTO_EDGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  if (!Number.isFinite(maxEdge) || maxEdge <= 0) return null
  const longest = Math.max(width, height)
  if (longest <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height), scaled: false }
  }
  const ratio = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  }
}

/**
 * Is this a video link we will accept?
 *
 * An empty value is fine — the field is optional, so `{ ok: true, url: null }`.
 * Anything else must be http/https AND on the VIDEO_HOSTS allowlist. The
 * protocol check is what refuses `javascript:` and `data:` URLs, both of which
 * `new URL()` parses perfectly happily.
 *
 * The host is matched on a dot boundary (`m.youtube.com` matches `youtube.com`,
 * but `notyoutube.com` does not), so the allowlist cannot be escaped by
 * prefixing or suffixing a name.
 */
export function validateVideoUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return { ok: true, url: null }

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, error: 'That does not look like a web address.' }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only http and https links can be accepted.' }
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const allowed = VIDEO_HOSTS.some(h => host === h || host.endsWith(`.${h}`))
  if (!allowed) {
    return {
      ok: false,
      error: `Video links must be from ${VIDEO_HOSTS.slice(0, 4).join(', ')} and similar — upload the clip there and paste the link.`,
    }
  }

  return { ok: true, url: parsed.toString() }
}

/** Human-readable byte size, for the "what am I about to send" label. */
export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Is this a clip we can attach?
 *
 * ## What this deliberately does NOT do
 *
 * Transcode. There is no reliable in-browser re-encoder — `MediaRecorder` can
 * only capture a live stream, and a WASM ffmpeg is a multi-megabyte dependency
 * that would take minutes on the phone this is for. So the cap is enforced by
 * bytes and nothing else: if the file is too big, the person is told so, with
 * the alternative (put it on YouTube, paste the link) in the same sentence. A
 * half-transcoded clip that plays for four seconds and stops would be worse
 * than a refusal, because it still looks like evidence.
 *
 * No duration probe either, for the same reason — reading duration means
 * decoding metadata, and a file we cannot decode is one we cannot measure.
 *
 * The extension is checked as well as the reported mime because a phone often
 * reports none at all. `.mov` and `.m4v` are accepted here and will be stored
 * as `video/mp4` by the server, which sniffs the container itself — the browser
 * calls an iPhone recording `video/quicktime`, and sending that would manufacture
 * a declared-vs-sniffed mismatch the server would rightly refuse.
 */
export function validateVideoFile(file) {
  if (!file) return { ok: false, error: 'No clip selected.' }

  const size = Number(file.size)
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: `${file.name || 'That file'} is empty.` }
  }
  if (size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      error: `${file.name || 'That clip'} is ${formatBytes(size)} — over the ${formatBytes(MAX_VIDEO_BYTES)} limit for an attached clip. Put it on YouTube, Facebook or Drive and paste the link instead; a link has no size limit here.`,
    }
  }

  const name = (file.name || '').toLowerCase()
  const type = (file.type || '').toLowerCase()
  const typeOk = VIDEO_FILE_MIMES.includes(type)
  const extOk = VIDEO_FILE_EXTENSIONS.some(ext => name.endsWith(ext))
  if (!typeOk && !extOk) {
    return {
      ok: false,
      error: `${file.name || 'That file'} is not a clip we can attach — use an MP4, M4V, MOV or WebM file, or link to it instead.`,
    }
  }

  return {
    ok: true,
    bytes: size,
    // Only ever one of the two formats, or null. Null means "we are not
    // claiming a type" — the server sniffs the bytes and stores what it finds.
    declaredMime: typeOk ? type : null,
  }
}

/** True when the browser reports a format it almost certainly cannot decode. */
export function looksUndecodable(file) {
  const type = (file?.type || '').toLowerCase()
  const name = (file?.name || '').toLowerCase()
  return type.includes('heic') || type.includes('heif') || /\.(heic|heif)$/.test(name)
}

/**
 * Take a `File` from a file input and return a downscaled WebP blob.
 *
 * Re-encoding through a canvas is not only about size. It is also what strips
 * EXIF, and EXIF from a phone camera carries GPS coordinates. A resident
 * photographing a flooded street outside their own home should not be
 * publishing their home address along with it, and they will never think to
 * check. So the pixels are redrawn from scratch and the metadata is left behind.
 *
 * `deps` exists so this can be tested without a canvas:
 *   { decode, makeCanvas, toBlob }
 */
export async function downscaleImage(file, deps = {}) {
  const {
    decode = defaultDecode,
    makeCanvas = defaultMakeCanvas,
    toBlob = defaultToBlob,
  } = deps

  if (!file) return { ok: false, error: 'No file selected.' }

  if (looksUndecodable(file)) {
    return {
      ok: false,
      error: `${file.name || 'That photo'} is an HEIC/HEIF file, which browsers cannot read. Set your phone camera to "Most Compatible", or share it as a screenshot.`,
    }
  }

  let source
  try {
    source = await decode(file)
  } catch {
    // The common real cause is a format the browser cannot decode at all.
    return { ok: false, error: `Could not read ${file.name || 'that photo'} — the browser cannot decode its format.` }
  }

  let size
  let blob
  try {
    size = fitWithin(source?.width, source?.height, MAX_PHOTO_EDGE)
    if (!size) {
      return { ok: false, error: `Could not read the dimensions of ${file.name || 'that photo'}.` }
    }

    const canvas = makeCanvas(size.width, size.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(source.bitmap, 0, 0, size.width, size.height)
    blob = await toBlob(canvas)
  } catch {
    return { ok: false, error: `Could not process ${file.name || 'that photo'}.` }
  }
  finally {
    // Release the decoded bitmap promptly, on every path that got as far as a
    // decode — a phone photo is tens of megabytes of uncompressed pixels, and
    // three of them held at once is real memory. This has to wrap the dimensions
    // check as well: the early return above it used to escape the release
    // entirely, which was the one path the previous `finally` did not cover.
    try { source?.bitmap?.close?.() } catch { /* not a bitmap, or already closed */ }
  }

  if (!blob) {
    return { ok: false, error: `Could not compress ${file.name || 'that photo'} — the browser produced no image.` }
  }

  if (blob.size > MAX_PHOTO_BYTES) {
    // Deliberately a refusal, not a silent truncation: a half-encoded photo of
    // a flooded street is worse than no photo, because it still looks real.
    return {
      ok: false,
      error: `Even after compression this photo is ${formatBytes(blob.size)} — over the ${formatBytes(MAX_PHOTO_BYTES)} limit. Try a smaller crop or a lower-resolution photo.`,
    }
  }

  return {
    ok: true,
    blob,
    bytes: blob.size,
    mime: blob.type || 'image/webp',
    width: size.width,
    height: size.height,
    originalBytes: Number(file.size) || null,
  }
}

/* ---------- browser defaults ---------- */

async function defaultDecode(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return { bitmap, width: bitmap.width, height: bitmap.height }
  }
  // Older Safari without createImageBitmap: decode through an <img>.
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode failed'))
      el.src = url
    })
    return { bitmap: img, width: img.naturalWidth, height: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function defaultMakeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function defaultToBlob(canvas) {
  return new Promise(resolve => {
    if (typeof canvas.convertToBlob === 'function') {
      canvas.convertToBlob({ type: 'image/webp', quality: PHOTO_QUALITY }).then(resolve, () => resolve(null))
      return
    }
    canvas.toBlob(resolve, 'image/webp', PHOTO_QUALITY)
  })
}

/**
 * A blob's bytes as bare base64 (no `data:` prefix), which is the shape the
 * server expects. The +33% that base64 costs is the price of not adding a
 * multipart dependency — cheap for a 600 kB photo, and the reason a 25 MB clip
 * arrives as a 33 MB string and is rate-limited accordingly.
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : '')
    }
    reader.onerror = () => reject(new Error('could not read the file'))
    reader.readAsDataURL(blob)
  })
}
