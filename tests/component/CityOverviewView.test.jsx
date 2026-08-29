import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CityOverviewView from '../../src/components/CityOverviewView.jsx'
import { buildRisk } from '../helpers/riskFixtures.js'

vi.mock('../../src/components/CityMap.jsx', () => ({
  default: ({ hazard }) => <div data-testid="city-map" data-hazard={hazard} />,
}))

const renderView = (risk = buildRisk(), props = {}) =>
  render(
    <CityOverviewView
      risk={risk}
      done={{}}
      onOpenZone={vi.fn()}
      onNavigate={vi.fn()}
      {...props}
    />,
  )

describe('CityOverviewView', () => {
  it('renders the impact counters', () => {
    renderView()
    const reliefCard = screen.getByText('Relief capacity / day').closest('.lux-card-glass')
    expect(reliefCard.textContent).toContain('7,870')
    const zonesCard = screen.getByText('Zones ≥ High').closest('.lux-card-glass')
    expect(zonesCard.textContent).toContain('/ 8')
    const drainsCard = screen.getByText('Critical drains', { selector: 'p' }).closest('.lux-card-glass')
    expect(drainsCard).not.toBeNull()
  })

  it('summarizes the header line with high-risk zones and critical drains', () => {
    renderView()
    expect(screen.getByText(/of 8 zones at high risk/)).toBeInTheDocument()
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
