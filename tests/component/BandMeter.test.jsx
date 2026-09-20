import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BandMeter from '../../src/components/BandMeter.jsx'

/**
 * The meter's whole job is to state a position on the 0-100 scale. These tests
 * pin the two things that make that true — the value it reports, and the band
 * it names — plus the input handling, because the callers pass live feed values
 * that can arrive missing.
 */
describe('BandMeter', () => {
  const meter = () => screen.getByRole('meter')

  it('reports the score and its band', () => {
    render(<BandMeter score={82} />)
    expect(meter()).toHaveAttribute('aria-valuenow', '82')
    expect(meter()).toHaveAttribute('aria-valuemin', '0')
    expect(meter()).toHaveAttribute('aria-valuemax', '100')
    expect(meter()).toHaveAccessibleName('82 of 100, Severe band')
  })

  // The band boundaries are the model's, not the meter's: 25 belongs to
  // Moderate because `bandOf` is exclusive at the top of each band. Reading the
  // boundary from BANDS rather than restating it here is the point of the test.
  it('names the band from the model at the boundary', () => {
    const { unmount } = render(<BandMeter score={24} />)
    expect(meter()).toHaveAccessibleName('24 of 100, Safe band')
    unmount()

    render(<BandMeter score={25} />)
    expect(meter()).toHaveAccessibleName('25 of 100, Moderate band')
  })

  it('holds a score that arrives missing or out of range without throwing', () => {
    const { unmount } = render(<BandMeter score={undefined} />)
    expect(meter()).toHaveAttribute('aria-valuenow', '0')
    unmount()

    const second = render(<BandMeter score={140} />)
    expect(meter()).toHaveAttribute('aria-valuenow', '100')
    second.unmount()

    render(<BandMeter score={NaN} />)
    expect(meter()).toHaveAttribute('aria-valuenow', '0')
  })

  // The fill is a clip over the full ramp so the band segments keep their real
  // relative widths. A `width: N%` bar would silently redraw the boundaries,
  // so the clip is worth asserting rather than leaving to review.
  it('clips the fill to the score rather than resizing the ramp', () => {
    const { container } = render(<BandMeter score={40} />)
    const fill = container.querySelector('[style*="clip-path"]')
    expect(fill.style.clipPath).toBe('inset(0 60% 0 0)')
  })
})
