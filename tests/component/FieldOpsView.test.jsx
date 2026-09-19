import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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

describe('FieldOpsView — crew roster', () => {
  // The card's own note opens with "Crew roster is a prototype model", so a
  // plain /Crew roster/i matches two nodes. Anchor on the heading.
  const roster = () => screen.getByText(/^Crew roster(?! is)/).closest('.lux-card-glass')

  it('lists every crew with depot, shift and load', () => {
    renderView()
    const text = roster().textContent
    expect(text).toContain('Crew Alpha')
    expect(text).toContain('Shahdara Depot · 06:00')
    expect(text).toMatch(/0\/3/)
    expect(text).toMatch(/0\/2/) // Crew Charlie runs a shorter two-task shift
    expect(text).not.toMatch(/Over capacity/)
  })

  it('counts only the open tasks assigned to each crew', () => {
    renderView(buildRisk(), { assignments: { d1: 'crew-1', d3: 'crew-1', d8: 'crew-1' } })
    expect(roster().textContent).toMatch(/3\/3/)
    expect(roster().textContent).not.toMatch(/Over capacity/)
  })

  it('excludes serviced tasks from the load', () => {
    const risk = buildRisk()
    renderView(risk, { done: { d1: true, d3: true }, assignments: { d1: 'crew-1', d3: 'crew-1', d8: 'crew-1' } })
    expect(roster().textContent).toMatch(/1\/3/)
  })

  it('flags a crew that is over its shift capacity', () => {
    renderView(buildRisk(), { assignments: { d1: 'crew-1', d3: 'crew-1', d2: 'crew-1', d8: 'crew-1' } })
    expect(roster().textContent).toMatch(/4\/3/)
    expect(roster().textContent).toMatch(/Over capacity/)
  })

  it('states plainly that the roster is a model', () => {
    renderView()
    expect(roster().textContent).toMatch(/prototype model/i)
    expect(roster().textContent).toMatch(/no live WASA\/LWMC integration/i)
  })
})

describe('FieldOpsView — assignment', () => {
  beforeEach(() => {
    vi.stubGlobal('open', vi.fn())
  })

  it('offers the assign control on an open task', () => {
    renderView()
    const card = openFirstTask()
    expect(within(card).getByLabelText(/Assign crew/i)).toBeInTheDocument()
  })

  it('reports the assignment to the caller, keeping onComplete single-argument', () => {
    const risk = buildRisk()
    const onAssign = vi.fn()
    renderView(risk, { onAssign })
    const card = openFirstTask()
    fireEvent.change(within(card).getByLabelText(/Assign crew/i), { target: { value: 'crew-2' } })
    expect(onAssign).toHaveBeenCalledWith(risk.taskQueue[0].id, 'crew-2')
  })

  it('suggests the nearest depot for the top task', () => {
    // d1 is the Shahdara trunk drain; Crew Alpha is based at Shahdara Depot.
    renderView()
    const card = openFirstTask()
    expect(within(card).getByText(/Suggested: Crew Alpha/)).toBeInTheDocument()
  })

  it('shows the assigned crew on the queue row', () => {
    renderView(buildRisk(), { assignments: { d1: 'crew-2' } })
    const card = screen.getAllByText(/live model/i)[0].closest('.lux-card-glass')
    expect(card.textContent).toContain('Crew Bravo')
  })

  it('drops the suggestion once that crew is the assignment', () => {
    renderView(buildRisk(), { assignments: { d1: 'crew-1' } })
    const card = openFirstTask()
    expect(within(card).queryByText(/Suggested:/)).not.toBeInTheDocument()
    expect(within(card).getByText(/depot Shahdara Depot/)).toBeInTheDocument()
  })

  it('lets a crew be unassigned', () => {
    const onAssign = vi.fn()
    renderView(buildRisk(), { assignments: { d1: 'crew-2' }, onAssign })
    const card = openFirstTask()
    fireEvent.change(within(card).getByLabelText(/Assign crew/i), { target: { value: '' } })
    expect(onAssign).toHaveBeenCalledWith('d1', '')
  })

  it('works without an onAssign handler', () => {
    renderView()
    const card = openFirstTask()
    expect(() => fireEvent.change(within(card).getByLabelText(/Assign crew/i), { target: { value: 'crew-3' } })).not.toThrow()
  })
})
