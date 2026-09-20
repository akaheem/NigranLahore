import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RainTimeline, AqiSparkline } from '../../src/components/Timeline24h.jsx'

const times = Array.from({ length: 24 }, (_, i) => {
  const h = String((10 + i) % 24).padStart(2, '0')
  return `2026-08-29T${h}:00`
})

describe('RainTimeline', () => {
  it('renders one bar per hour with mm titles', () => {
    const hours = Array.from({ length: 24 }, (_, i) => i % 5)
    const { container } = render(<RainTimeline hours={hours} times={times} />)
    const bars = container.querySelectorAll('[data-testid="rain-bar"]')
    expect(bars).toHaveLength(24)
    // the tooltip is a feature, not a test hook — but it is what tells a
    // hovering reader the hour and the millimetres, so it is worth pinning
    expect(bars[0].getAttribute('title')).toMatch(/mm/)
  })

  it('falls back to a waiting message when empty', () => {
    render(<RainTimeline hours={[]} times={[]} />)
    expect(screen.getByText(/Waiting for the live Open-Meteo/i)).toBeInTheDocument()
  })

  it('labels every third hour', () => {
    const { container } = render(<RainTimeline hours={Array.from({ length: 24 }, () => 0)} times={times} />)
    const labels = [...container.querySelectorAll('[data-testid="rain-label"]')]
    // empty-string labels contain a single non-breaking space
    const visible = labels.filter(el => el.textContent.trim() !== '')
    expect(labels.length).toBe(24)
    expect(visible.length).toBe(8) // 24/3
  })

  it('labels every twelfth hour in compact (72h) mode and tints by probability', () => {
    const hours72 = Array.from({ length: 72 }, () => 0)
    const times72 = Array.from({ length: 72 }, (_, i) => `2026-08-29T${String((10 + i) % 24).padStart(2, '0')}:00`)
    const prob72 = Array.from({ length: 72 }, (_, i) => (i % 2 === 0 ? 90 : 10))
    const { container } = render(<RainTimeline hours={hours72} times={times72} prob={prob72} compact />)
    const labels = [...container.querySelectorAll('[data-testid="rain-label"]')]
    const visible = labels.filter(el => el.textContent.trim() !== '')
    expect(labels.length).toBe(72)
    expect(visible.length).toBe(6) // 72/12
    // probability tint: 90% bar darker than 10% bar
    const bars = container.querySelectorAll('[data-testid="rain-bar"]')
    expect(bars.length).toBe(72)
  })

  /**
   * A dry window is the common case, and it used to draw two dozen green stubs.
   * Green means "trace rain" everywhere else in this chart, so a day with no
   * rain at all rendered as a day with a little — the exact reading a flood
   * dashboard cannot afford to get wrong.
   */
  it('reads a flat outlook as dry rather than as trace rain', () => {
    const { container } = render(<RainTimeline hours={Array.from({ length: 24 }, () => 0)} times={times} />)
    expect(screen.getByText(/No meaningful rain expected/i)).toBeInTheDocument()
    const bars = [...container.querySelectorAll('[data-testid="rain-bar"]')]
    expect(bars).toHaveLength(24)
    expect(bars.every(b => b.style.backgroundColor === 'var(--border-medium)')).toBe(true)
  })

  it('draws a wet hour in its calibrated band colour', () => {
    const { container } = render(<RainTimeline hours={[0, 1, 8, 20, 40]} times={times.slice(0, 5)} />)
    const bars = [...container.querySelectorAll('[data-testid="rain-bar"]')]
    expect(bars.map(b => b.style.backgroundColor)).toEqual([
      'var(--border-medium)', // 0   — dry
      'var(--risk-safe)', //      1   — under the 5mm line
      'var(--risk-moderate)', //  8   — the 5mm band
      'var(--risk-high)', //      20  — the 15mm band
      'var(--risk-severe)', //    40  — past 30mm
    ])
  })

  /**
   * The axis has to be stable, because a scale that redraws itself on every
   * feed tick makes two screenshots of the same chart incomparable. It tops out
   * on the next calibrated figure up, never on the window's own maximum.
   */
  it('puts the axis on a calibrated figure rather than the window maximum', () => {
    const { container } = render(<RainTimeline hours={[0, 0, 8, 0]} times={times.slice(0, 4)} />)
    expect(screen.getByText('15')).toBeInTheDocument() // not 8
    const bars = [...container.querySelectorAll('[data-testid="rain-bar"]')]
    expect(parseFloat(bars[2].style.height)).toBeCloseTo((8 / 15) * 100, 5)
  })
})

describe('AqiSparkline', () => {
  it('renders the polyline and current/max labels', () => {
    render(<AqiSparkline series={[100, 150, 200]} times={times.slice(0, 3)} />)
    expect(document.querySelector('polyline')).toBeInTheDocument()
    expect(screen.getByText(/Now 200/)).toBeInTheDocument()
    expect(screen.getByText(/24h max 200/)).toBeInTheDocument()
  })

  it('falls back to a waiting message when empty', () => {
    render(<AqiSparkline series={[]} times={[]} />)
    expect(screen.getByText(/Waiting for the live Open-Meteo/i)).toBeInTheDocument()
  })
})
