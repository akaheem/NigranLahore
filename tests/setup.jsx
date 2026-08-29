import { afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

// jsdom lacks these browser APIs; Leaflet and the app reference them
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Leaflet cannot render in jsdom — stub the react-leaflet surface
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ children }) => <div data-testid="circle-marker">{children}</div>,
  Marker: ({ children }) => <div data-testid="marker">{children}</div>,
  Popup: ({ children }) => <div data-testid="popup">{children}</div>,
  useMap: () => ({ flyTo: vi.fn() }),
}))

vi.mock('leaflet', () => ({
  default: {
    divIcon: opts => opts,
  },
}))

afterEach(() => {
  window.localStorage.clear()
})
