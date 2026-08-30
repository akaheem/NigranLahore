import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FieldOpsView from '../../src/components/FieldOpsView.jsx'
import { buildRisk } from '../helpers/riskFixtures.js'

vi.mock('../../src/components/CityMap.jsx', () => ({
  default: () => <div data-testid="city-map" />,
}))

const renderView = (risk = buildRisk(), props = {}) =>
  render(
    <FieldOpsView
      risk={risk}
      done={{}}
      onComplete={vi.fn()}
      onSwitch={vi.fn()}
      {...props}
    />,
  )

const openFirstTask = () => {
  const card = screen.getAllByText(/live model/i)[0].closest('.lux-card-glass')
  fireEvent.click(card)
  return card
}

describe('FieldOpsView', () => {
  beforeEach(() => {
    vi.stubGlobal('open', vi.fn())
  })

  it('renders 8 tasks ranked in queue order', () => {
    renderView()
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('08')).toBeInTheDocument()
  })

  it('shows the real population in the why-now line (190k for Shahdara)', () => {
    renderView()
    openFirstTask()
    expect(screen.getByText(/population 190k exposed/i)).toBeInTheDocument()
  })

  it('marks serviced via onComplete and re-ranks remaining tasks', () => {
    const risk = buildRisk()
    const done = { [risk.taskQueue[0].id]: true }
    const onComplete = vi.fn()

    // after #1 is done, the next open task displays rank 01
    render(<FieldOpsView risk={risk} done={done} onComplete={onComplete} onSwitch={vi.fn()} />)
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.queryByText('08')).not.toBeInTheDocument() // completed task has no rank

    // click the first OPEN card (the done task's card is non-interactive)
    const openCards = screen.getAllByText(/live model/i).map(el => el.closest('.lux-card-glass')).filter(c => c && c.style.opacity !== '0.45')
    fireEvent.click(openCards[0])
    fireEvent.click(screen.getByText(/Mark serviced/i))
    expect(onComplete).toHaveBeenCalledWith(risk.taskQueue[1].id)
  })

  it('opens Google Maps for the task on Navigate', () => {
    renderView()
    openFirstTask()
    fireEvent.click(screen.getByText(/Navigate/i))
    expect(window.open).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/www\.google\.com\/maps\?q=/),
      '_blank',
      'noopener',
    )
  })

  it('shows an em-dash rain counter when forecast is missing', () => {
    renderView(buildRisk({ rain6hMm: null }))
    const rainCard = screen.getByText('Rain 6h').closest('.lux-card-glass')
    expect(rainCard.textContent).toContain('—')
  })

  it('renders the completion impact with real tonnage + residents', () => {
    renderView()
    expect(screen.getByText(/Completion impact/i)).toBeInTheDocument()
    expect(screen.getByText(/residents from ponding/i)).toBeInTheDocument()
    expect(screen.getByText(/tons/)).toBeInTheDocument()
  })

  it('cites the sore-point record', () => {
    renderView()
    expect(screen.getByText(/WASA tracks 55/)).toBeInTheDocument()
  })
})
