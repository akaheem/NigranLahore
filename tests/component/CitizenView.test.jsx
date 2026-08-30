import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CitizenView from '../../src/components/CitizenView.jsx'
import { buildRisk, shahdara } from '../helpers/riskFixtures.js'

vi.mock('../../src/components/CityMap.jsx', () => ({
  default: ({ selectedZone }) => <div data-testid="city-map">{selectedZone?.name}</div>,
}))

const renderView = (risk = buildRisk(), props = {}) =>
  render(
    <CitizenView
      risk={risk}
      selectedZone={shahdara}
      onSelectZone={vi.fn()}
      showCool
      onToggleCool={vi.fn()}
      onSwitch={vi.fn()}
      {...props}
    />,
  )

describe('CitizenView', () => {
  it('renders the live stat strip with rain mm', () => {
    renderView()
    expect(screen.getByText('12.0')).toBeInTheDocument()
    expect(screen.getByText('150')).toBeInTheDocument() // AQI
    expect(screen.getByText('34°C')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
  })

  it('shows an em-dash when rain data is missing', () => {
    renderView(buildRisk({ rain6hMm: null, weather: { ...buildRisk().weather, next6h: [] } }))
    const rainCard = screen.getByText(/Rain next 6h — Shahdara/).closest('.lux-card-glass')
    expect(rainCard.textContent).toContain('—')
  })

  it('withholds values honestly when offline (no invented numbers)', () => {
    renderView(buildRisk({ status: 'offline' }))
    expect(screen.getByText(/Live feed unreachable — values withheld/i)).toBeInTheDocument()
  })

  it('selects a zone via the dropdown', () => {
    const onSelectZone = vi.fn()
    renderView(buildRisk(), { onSelectZone })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'gulberg' } })
    expect(onSelectZone).toHaveBeenCalledWith(expect.objectContaining({ id: 'gulberg' }))
  })

  it('shows the flood score and action list', () => {
    renderView()
    expect(screen.getByText(/What to do now/i)).toBeInTheDocument()
    const scoreEl = document.querySelector('.font-editorial.text-6xl')
    expect(scoreEl.textContent).toBe('92')
  })

  it('renders air and heat why cards', () => {
    renderView()
    expect(screen.getByText(/Air quality/i)).toBeInTheDocument()
    expect(screen.getByText(/Heat stress/i)).toBeInTheDocument()
  })

  it('switches to the field team view', () => {
    const onSwitch = vi.fn()
    renderView(buildRisk(), { onSwitch })
    fireEvent.click(screen.getByText(/Field team view/i))
    expect(onSwitch).toHaveBeenCalled()
  })

  it('shows the locate-me message when geolocation is unavailable', () => {
    const original = navigator.geolocation
    Object.defineProperty(globalThis.navigator, 'geolocation', { value: undefined, configurable: true })
    renderView()
    fireEvent.click(screen.getByText(/Locate me/i))
    expect(screen.getByText(/Location not available/i)).toBeInTheDocument()
    Object.defineProperty(globalThis.navigator, 'geolocation', { value: original, configurable: true })
  })
})
