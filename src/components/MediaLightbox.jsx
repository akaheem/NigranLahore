import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Full-screen photo viewer.
 *
 * Deliberately not a third-party lightbox: this renders photographs that
 * strangers uploaded, and the whole surface is about thirty lines. Keyboard
 * operable (Esc closes, arrow keys step through) because a viewer you cannot
 * leave without a mouse is a trap, and focus is returned to whatever opened it
 * so the board does not lose the reader's place.
 */
export default function MediaLightbox({ photos = [], startIndex = 0, onClose }) {
  const count = photos.length
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(count - 1, 0)))
  const closeRef = useRef(null)
  const restoreRef = useRef(null)

  const step = useCallback((delta) => {
    if (count < 2) return
    // Wraps, so a reader can keep pressing in one direction.
    setIndex(i => (i + delta + count) % count)
  }, [count])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
      else if (event.key === 'ArrowRight') step(1)
      else if (event.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, step])

  // The page behind must not scroll while this is up, and the element that
  // opened it gets focus back on close.
  useEffect(() => {
    restoreRef.current = document.activeElement
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previous
      try { restoreRef.current?.focus?.() } catch { /* element has gone */ }
    }
  }, [])

  if (!count) return null
  const photo = photos[Math.min(index, count - 1)]

  const control = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.35)',
    background: 'rgba(6,35,30,0.55)',
    color: '#FFFFFF',
    cursor: 'pointer',
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${Math.min(index, count - 1) + 1} of ${count}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'rgba(6, 35, 30, 0.9)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <img
        src={photo.src}
        alt={photo.alt || ''}
        onClick={event => event.stopPropagation()}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          borderRadius: 12,
          objectFit: 'contain',
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      />

      <button
        ref={closeRef}
        type="button"
        aria-label="Close photo"
        onClick={(event) => { event.stopPropagation(); onClose?.() }}
        style={{ ...control, position: 'absolute', top: '1.25rem', right: '1.25rem' }}
      >
        <X size={18} />
      </button>

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={(event) => { event.stopPropagation(); step(-1) }}
            style={{ ...control, position: 'absolute', left: '1.25rem' }}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={(event) => { event.stopPropagation(); step(1) }}
            style={{ ...control, position: 'absolute', right: '1.25rem' }}
          >
            <ChevronRight size={20} />
          </button>
          <p
            className="font-accent text-micro tracking-label"
            style={{
              position: 'absolute',
              bottom: '1.25rem',
              color: 'rgba(255,255,255,0.85)',
            }}
          >
            {Math.min(index, count - 1) + 1} / {count}
          </p>
        </>
      )}
    </div>
  )
}
