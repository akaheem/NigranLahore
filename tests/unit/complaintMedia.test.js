import { describe, it, expect, vi } from 'vitest'
import {
  fitWithin, validateVideoUrl, validateVideoFile, formatBytes, looksUndecodable,
  downscaleImage, MAX_PHOTO_EDGE,
} from '../../src/lib/complaintMedia.js'
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from '../../src/data/complaints.js'

describe('fitWithin', () => {
  it('scales the long edge down to the cap and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1400, height: 1050, scaled: true })
    expect(fitWithin(3000, 4000)).toEqual({ width: 1050, height: 1400, scaled: true })
  })

  it('never scales a photo UP', () => {
    // Interpolating a small photo into a bigger blurry one costs bytes and buys
    // nothing — the detail was never there.
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false })
    expect(fitWithin(MAX_PHOTO_EDGE, 10)).toEqual({ width: MAX_PHOTO_EDGE, height: 10, scaled: false })
  })

  it('refuses dimensions that are not usable positive numbers', () => {
    // A 0x0 canvas is a silent failure; null here becomes a readable message.
    for (const [w, h] of [[0, 100], [100, 0], [-5, 100], [NaN, 100], [Infinity, 10], [undefined, 10], [null, null]]) {
      expect(fitWithin(w, h)).toBeNull()
    }
  })
})

describe('validateVideoUrl', () => {
  it('treats an empty value as fine, because the field is optional', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(validateVideoUrl(value)).toEqual({ ok: true, url: null })
    }
  })

  it('accepts the platforms people actually upload to', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=abc',
      'https://youtu.be/abc',
      'https://m.youtube.com/watch?v=abc',
      'https://facebook.com/watch/?v=1',
      'https://vimeo.com/12345',
      'https://drive.google.com/file/d/abc/view',
    ]) {
      expect(validateVideoUrl(url).ok).toBe(true)
    }
  })

  it('refuses javascript: and data: links', () => {
    // `new URL()` parses both without complaint, so the protocol check is the
    // only thing standing between a pasted link and a script in the page.
    expect(validateVideoUrl('javascript:alert(1)').ok).toBe(false)
    expect(validateVideoUrl('data:text/html,<script>alert(1)</script>').ok).toBe(false)
  })

  it('refuses a host that merely contains an allowed one', () => {
    expect(validateVideoUrl('https://notyoutube.com/watch?v=1').ok).toBe(false)
    expect(validateVideoUrl('https://youtube.com.evil.example/x').ok).toBe(false)
    expect(validateVideoUrl('https://evil.example/?next=youtube.com').ok).toBe(false)
  })

  it('returns a readable reason rather than just false', () => {
    expect(validateVideoUrl('nonsense').error).toMatch(/web address/)
    expect(validateVideoUrl('https://example.com/x').error).toMatch(/youtube/)
  })
})

describe('validateVideoFile — the attached clip', () => {
  const clip = (over = {}) => ({ name: 'clip.mp4', type: 'video/mp4', size: 2 * 1024 * 1024, ...over })

  it('accepts a clip under the cap', () => {
    const result = validateVideoFile(clip())
    expect(result.ok).toBe(true)
    expect(result.bytes).toBe(2 * 1024 * 1024)
  })

  it('refuses an oversize clip with the alternative in the same sentence', () => {
    // There is no in-browser transcode, so bytes are the only lever — and a
    // refusal that does not say what to do instead is a dead end.
    const result = validateVideoFile(clip({ size: MAX_VIDEO_BYTES + 1 }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('25.0 MB')
    expect(result.error).toContain('YouTube')
  })

  it('allows exactly the cap, so the boundary is not off by one', () => {
    expect(validateVideoFile(clip({ size: MAX_VIDEO_BYTES })).ok).toBe(true)
  })

  it('accepts an iPhone .mov without claiming a type the server would refuse', () => {
    // The browser calls its own recording `video/quicktime` while the bytes are
    // ISO-BMFF. Relaying that would manufacture a declared-vs-sniffed mismatch
    // the server would rightly reject, so the client declines to label it and
    // lets the sniffer decide.
    const result = validateVideoFile(clip({ name: 'IMG_0042.mov', type: 'video/quicktime' }))
    expect(result.ok).toBe(true)
    expect(result.declaredMime).toBeNull()
  })

  it('does label the two formats it can be sure of', () => {
    expect(validateVideoFile(clip({ name: 'a.mp4', type: 'video/mp4' })).declaredMime).toBe('video/mp4')
    expect(validateVideoFile(clip({ name: 'a.webm', type: 'video/webm' })).declaredMime).toBe('video/webm')
  })

  it('accepts a clip by extension when the phone reports no type at all', () => {
    expect(validateVideoFile(clip({ name: 'clip.m4v', type: '' })).ok).toBe(true)
    expect(validateVideoFile(clip({ name: 'clip.webm', type: '' })).ok).toBe(true)
  })

  it('refuses something that is not a clip, naming what would be', () => {
    const result = validateVideoFile(clip({ name: 'notes.pdf', type: 'application/pdf' }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('MP4')
  })

  it('refuses an empty file and a missing one', () => {
    expect(validateVideoFile(clip({ size: 0 })).ok).toBe(false)
    expect(validateVideoFile(clip({ size: NaN })).ok).toBe(false)
    expect(validateVideoFile(null).ok).toBe(false)
  })

  it('does not claim to measure duration, because it cannot', () => {
    // Reading duration means decoding metadata, and a file we cannot decode is
    // one we cannot measure. The cap is bytes and only bytes.
    const result = validateVideoFile(clip())
    expect(result.durationSeconds).toBeUndefined()
  })
})

describe('formatBytes', () => {
  it('reads in the unit a person would use', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(600 * 1024)).toBe('600 KB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })

  it('does not print NaN at a caller that passed nothing', () => {
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })
})

describe('looksUndecodable', () => {
  it('spots an iPhone HEIC by type or by extension', () => {
    expect(looksUndecodable({ type: 'image/heic', name: 'IMG_1.HEIC' })).toBe(true)
    expect(looksUndecodable({ type: '', name: 'IMG_2.heif' })).toBe(true)
    expect(looksUndecodable({ type: 'image/jpeg', name: 'IMG_3.jpg' })).toBe(false)
  })
})

/** A fake canvas stack, so the browser-only path is testable without a canvas. */
const fakeDeps = ({ width = 4000, height = 3000, blob = null, decodeFails = false } = {}) => {
  const ctx = { drawImage: vi.fn() }
  return {
    decode: decodeFails
      ? vi.fn().mockRejectedValue(new Error('nope'))
      : vi.fn().mockResolvedValue({ bitmap: { close: vi.fn() }, width, height }),
    makeCanvas: vi.fn(() => ({ getContext: () => ctx })),
    toBlob: vi.fn().mockResolvedValue(blob),
    ctx,
  }
}

describe('downscaleImage', () => {
  const file = { name: 'street.jpg', type: 'image/jpeg', size: 5_000_000 }

  it('re-encodes to the capped size and reports both sizes', async () => {
    const out = new Blob(['x'.repeat(1000)], { type: 'image/webp' })
    const deps = fakeDeps({ blob: out })
    const result = await downscaleImage(file, deps)

    expect(result.ok).toBe(true)
    expect(result.width).toBe(1400)
    expect(result.height).toBe(1050)
    expect(result.bytes).toBe(out.size)
    expect(result.originalBytes).toBe(5_000_000)
    expect(deps.makeCanvas).toHaveBeenCalledWith(1400, 1050)
  })

  it('refuses an oversize photo instead of truncating it', async () => {
    // A half-encoded photo of a flooded street is worse than no photo, because
    // it still looks real.
    const huge = new Blob(['x'.repeat(MAX_PHOTO_BYTES + 1)], { type: 'image/webp' })
    const result = await downscaleImage(file, fakeDeps({ blob: huge }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/limit/)
  })

  it('names the format when the browser cannot decode it', async () => {
    const heic = { name: 'IMG_4021.HEIC', type: 'image/heic', size: 3_000_000 }
    const result = await downscaleImage(heic, fakeDeps())
    expect(result.ok).toBe(false)
    // The message has to say what to do, not just that it failed.
    expect(result.error).toMatch(/HEIC/)
    expect(result.error).toMatch(/Most Compatible|screenshot/)
  })

  it('reports a decode failure rather than dropping the photo silently', async () => {
    const result = await downscaleImage(file, fakeDeps({ decodeFails: true }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/street\.jpg/)
  })

  it('reports a canvas that produces nothing', async () => {
    const result = await downscaleImage(file, fakeDeps({ blob: null }))
    expect(result.ok).toBe(false)
  })

  it('releases the decoded bitmap, which is tens of megabytes of pixels', async () => {
    const deps = fakeDeps({ blob: new Blob(['x'], { type: 'image/webp' }) })
    await downscaleImage(file, deps)
    const decoded = await deps.decode.mock.results[0].value
    expect(decoded.bitmap.close).toHaveBeenCalled()
  })

  it('releases it even when the decode succeeds but the dimensions are unusable', async () => {
    // The release used to sit in a `finally` around the canvas block alone, so this
    // path — a decode that works and reports 0x0 — returned before reaching it and
    // left the pixels open. The README claims the bitmap is released "on every
    // path"; this is the test that makes that claim true rather than aspirational.
    const deps = fakeDeps({ width: 0, height: 0 })
    const result = await downscaleImage(file, deps)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/dimensions/)
    const decoded = await deps.decode.mock.results[0].value
    expect(decoded.bitmap.close).toHaveBeenCalled()
  })

  it('has nothing to say about no file at all', async () => {
    expect((await downscaleImage(null)).ok).toBe(false)
  })
})
