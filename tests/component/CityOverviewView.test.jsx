import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CityOverviewView from '../../src/components/CityOverviewView.jsx'
import { buildRisk, buildTaskQueue } from '../helpers/riskFixtures.js'
import { ZONES } from '../../src/data/lahore.js'

vi.mock('../../src/components/CityMap.jsx', () => ({
  default: ({ hazard }) => <div data-testid="city-map" data-hazard={hazard} />,
}))

const renderView = (risk = buildRisk(), props = {}) =>
  render(
    <CityOverviewView
      risk={risk}
      onOpenZone={vi.fn()}
      onNavigate={vi.fn()}
      {...props}
    />,
  )

describe('CityOverviewView', () => {
  it('renders the impact counters', () => {
    renderView()
    // The four counters are one stat strip now, not four cards, so each value
    // is asserted inside its own tile of that strip.
    const reliefTile = screen.getByText('Relief capacity / day').closest('.stat-strip > *')
    expect(reliefTile.textContent).toContain('7,870')
    const zonesTile = screen.getByText('Zones ≥ High').closest('.stat-strip > *')
    expect(zonesTile.textContent).toContain('/ 8')
    // Nothing in the seed data has seized up, so the blocked count is a real 0
    // rather than a dash — the tile counts a lifecycle state, not a threshold.
    const blockedTile = screen.getByText('Blocked drains', { selector: 'p' }).closest('.stat-strip > *')
    expect(blockedTile.textContent).toContain('0')
  })

  it('counts a blocked drain in the tile and the header line', () => {
    const queue = buildTaskQueue().map(t => (t.id === 'd1' ? { ...t, fillPct: 95, state: 'blocked' } : t))
    renderView(buildRisk({ taskQueue: queue }))
    expect(screen.getByText('Blocked drains', { selector: 'p' }).closest('.stat-strip > *').textContent).toContain('1')
    expect(screen.getByText(/1 blocked/)).toBeInTheDocument()
  })

  it('summarizes the header line with high-risk zones and open drains', () => {
    renderView()
    expect(screen.getByText(/of 8 zones at high risk/)).toBeInTheDocument()
    expect(screen.getByText(/8 drains open, 0 blocked/)).toBeInTheDocument()
  })

  it('toggles hazard layers on the map', () => {
    renderView()
    expect(screen.getByTestId('city-map').dataset.hazard).toBe('flood')
    fireEvent.click(screen.getByRole('button', { name: 'Air' }))
    expect(screen.getByTestId('city-map').dataset.hazard).toBe('air')
    fireEvent.click(screen.getByRole('button', { name: 'Heat' }))
    expect(screen.getByTestId('city-map').dataset.hazard).toBe('heat')
  })

  it('renders the 24h rain timeline bars', () => {
    const { container } = renderView()
    const bars = container.querySelectorAll('[title*="mm"]')
    expect(bars.length).toBe(24)
  })

  it('opens a zone in the Citizen view via the zone table', () => {
    const onOpenZone = vi.fn()
    renderView(buildRisk(), { onOpenZone })
    const firstOpen = screen.getAllByText(/Open →/i)[0]
    fireEvent.click(firstOpen)
    expect(onOpenZone).toHaveBeenCalledWith(expect.any(String))
  })

  it('navigates to the other views', () => {
    const onNavigate = vi.fn()
    renderView(buildRisk(), { onNavigate })
    fireEvent.click(screen.getByText(/← Citizen/i))
    expect(onNavigate).toHaveBeenCalledWith('citizen')
    fireEvent.click(screen.getByText(/Field Ops →/i))
    expect(onNavigate).toHaveBeenCalledWith('ops')
  })
})

/**
 * The zone list became a table: eight hand-rolled flex rows with no header row
 * and no order at all. The order is the thing that makes it a table rather
 * than a list — an operator opening this screen wants the worst zone first
 * without having to ask for it — so the sort is what gets pinned here.
 *
 * The order assertions are relative (sorted() against a copy of what rendered)
 * so they survive the seed scores changing; what they defend is that clicking a
 * column heading actually reorders the rows.
 */
describe('CityOverviewView — zone table', () => {
  const names = () => [...document.querySelectorAll('.zone-table__name')].map(el => el.textContent)
  const scores = () => [...document.querySelectorAll('.zone-table tbody tr')]
    .map(tr => Number(tr.querySelector('.figure').textContent))
  const residents = () => [...document.querySelectorAll('.zone-table tbody tr')]
    .map(tr => Number(tr.children[2].textContent.replace(/,/g, '')))

  it('renders one row per zone, each with its risk on a band meter', () => {
    renderView()
    expect(document.querySelectorAll('.zone-table tbody tr')).toHaveLength(ZONES.length)
    expect(document.querySelectorAll('.zone-table tbody [role="meter"]')).toHaveLength(ZONES.length)
  })

  it('opens on the highest risk first, and says so', () => {
    renderView()
    const shown = scores()
    expect(shown).toEqual([...shown].sort((a, b) => b - a))
    expect(screen.getByRole('columnheader', { name: /risk/i })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByText(/Sorted by risk, high to low/)).toBeInTheDocument()
  })

  it('reverses the risk order when the same column is clicked again', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Risk' }))
    const shown = scores()
    expect(shown).toEqual([...shown].sort((a, b) => a - b))
    expect(screen.getByRole('columnheader', { name: /risk/i })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByText(/Sorted by risk, low to high/)).toBeInTheDocument()
  })

  it('sorts alphabetically by zone, in both directions', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Zone' }))
    expect(names()).toEqual([...names()].sort((a, b) => a.localeCompare(b)))
    fireEvent.click(screen.getByRole('button', { name: 'Zone' }))
    expect(names()).toEqual([...names()].sort((a, b) => b.localeCompare(a)))
  })

  it('sorts by residents, starting at the most populous', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Residents' }))
    const shown = residents()
    expect(shown).toEqual([...shown].sort((a, b) => b - a))
    expect(screen.getByText(/Sorted by residents, high to low/)).toBeInTheDocument()
  })

  it('marks the sorted column and leaves the others unsorted', () => {
    renderView()
    expect(screen.getByRole('columnheader', { name: /zone/i })).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByRole('columnheader', { name: /residents/i })).toHaveAttribute('aria-sort', 'none')
  })
})
