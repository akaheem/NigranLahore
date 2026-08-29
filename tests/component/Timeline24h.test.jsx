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
    expect(container.querySelectorAll('[title*="mm"]')).toHaveLength(24)
  })

  it('falls back to a loading message when empty', () => {
    render(<RainTimeline hours={[]} times={[]} />)
    expect(screen.getByText(/loading live data/i)).toBeInTheDocument()
  })

  it('labels every third hour', () => {
    const { container } = render(<RainTimeline hours={Array.from({ length: 24 }, () => 0)} times={times} />)
    const labels = [...container.querySelectorAll('.flex-1.text-center')]
    // empty-string labels contain a single non-breaking space
    const visible = labels.filter(el => el.textContent.trim() !== '')
    expect(labels.length).toBe(24)
    expect(visible.length).toBe(8) // 24/3
  })
})

describe('AqiSparkline', () => {
  it('renders the polyline and current/max labels', () => {
    render(<AqiSparkline series={[100, 150, 200]} times={times.slice(0, 3)} />)
    expect(document.querySelector('polyline')).toBeInTheDocument()
    expect(screen.getByText(/Now 200/)).toBeInTheDocument()
    expect(screen.getByText(/24h max 200/)).toBeInTheDocument()
  })

  it('falls back to a loading message when empty', () => {
    render(<AqiSparkline series={[]} times={[]} />)
    expect(screen.getByText(/loading live data/i)).toBeInTheDocument()
  })
})
