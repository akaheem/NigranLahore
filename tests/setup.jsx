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

// Leaflet cannot render in jsdom — stub the react-leaflet surface.
//
// Every component the app imports must be listed here, not only the common
// ones: a missing entry is `undefined` at render, which fails as "Element type
// is invalid" and reads like a bug in whichever component happened to use it
// first. `Circle` is the accuracy ring around a pinned report.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Circle: ({ children }) => <div data-testid="circle">{children}</div>,
  CircleMarker: ({ children }) => <div data-testid="circle-marker">{children}</div>,
  Marker: ({ children }) => <div data-testid="marker">{children}</div>,
  Popup: ({ children }) => <div data-testid="popup">{children}</div>,
  Tooltip: ({ children }) => <div data-testid="tooltip">{children}</div>,
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
