import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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

describe('CitizenView — nearest relief', () => {
  const panel = () => screen.getByText(/Nearest relief from Shahdara/i).closest('.lux-card-glass')

  it('ranks the three closest relief assets from the selected zone', () => {
    const { container } = renderView()
    expect(panel()).toBeTruthy()
    const hrefs = [...container.querySelectorAll('a[href*="google.com/maps"]')]
      .map(a => a.getAttribute('href'))
    // Shahdara's own relief camp, then Chauburji Gate, then Shalimar — nearest first.
    expect(hrefs).toEqual([
      'https://www.google.com/maps?q=31.6412,74.2671',
      'https://www.google.com/maps?q=31.5714,74.3077',
      'https://www.google.com/maps?q=31.6204,74.3836',
    ])
  })

  it('shows distance, walk time and daily capacity for each asset', () => {
    renderView()
    const text = panel().textContent
    expect(text).toContain('Relief Camp — Shahdara Ground')
    expect(text).toContain('400 people/day')
    expect(text.match(/min walk/g)).toHaveLength(3)
  })

  it('states the assumptions behind the distances', () => {
    renderView()
    expect(panel().textContent).toMatch(/straight-line/i)
    expect(panel().textContent).toMatch(/4\.5 km\/h/)
  })

  it('degrades to a message when no asset is mapped', () => {
    renderView(buildRisk(), { selectedZone: { id: 'nowhere', name: 'Nowhere', lat: null, lng: null } })
    expect(screen.getByText(/No relief assets mapped near this zone/i)).toBeInTheDocument()
  })
})

describe('CitizenView — waste & drainage card', () => {
  const card = () => screen.getByText(/Waste & drainage — Shahdara/).closest('.lux-card-glass')

  it('renders the fourth hazard card with the zone score', () => {
    renderView()
    expect(card().textContent).toContain('73')
    expect(screen.getByText('Waste & drainage — Shahdara')).toBeInTheDocument()
  })

  it('explains the score from the zone’s own worst drain', () => {
    renderView()
    fireEvent.click(within(card()).getByText(/Why this number\?/i))
    expect(within(card()).getByText(/Drain D-1/)).toBeInTheDocument()
  })

  it('says so honestly when a zone has no drain telemetry', () => {
    renderView(buildRisk({
      drainCard: {
        score: 12,
        parts: { capacity: 88 },
        missing: { blockage: true, capacity: false, unserved: true, waste: true },
      },
    }))
    fireEvent.click(within(card()).getByText(/Why this number\?/i))
    expect(within(card()).getByText(/No drain telemetry/i)).toBeInTheDocument()
  })

  it('keeps the hazard numbering contiguous (V then the VI records strip)', () => {
    const { container } = renderView()
    const nums = [...container.querySelectorAll('.editorial-header-num')].map(el => el.textContent)
    expect(nums).toContain('V')
    expect(nums).toContain('VI — The city, lately')
  })
})
