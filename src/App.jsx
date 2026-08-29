import { useEffect } from 'react'
import Galaxy from './Galaxy.jsx'
import CitizenView from './components/CitizenView.jsx'
import FieldOpsView from './components/FieldOpsView.jsx'
import CityOverviewView from './components/CityOverviewView.jsx'
import DataStatus from './components/DataStatus.jsx'
import { useCityRisk } from './hooks/useCityRisk.js'
import { useLocalStorageState } from './hooks/useLocalStorageState.js'
import { ZONES } from './data/lahore.js'

const NAV = [
  { id: 'citizen', label: 'Citizen' },
  { id: 'ops', label: 'Field Ops' },
  { id: 'overview', label: 'City Overview' },
]

function App() {
  const [theme, setTheme] = useLocalStorageState('nigran-theme', 'dark')
  const [view, setView] = useLocalStorageState('nigran-view', 'citizen')
  const [zoneId, setZoneId] = useLocalStorageState('nigran-zone', 'shahdara')
  const [showCool, setShowCool] = useLocalStorageState('nigran-cool', true)
  const [done, setDone] = useLocalStorageState('nigran-done', {})

  const risk = useCityRisk()
  const selectedZone = ZONES.find(z => z.id === zoneId) ?? ZONES[0]

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const onComplete = (id) => setDone(d => ({ ...d, [id]: true }))
  const onOpenZone = (id) => {
    setZoneId(id)
    setView('citizen')
  }

  return (
    <div className="min-h-screen relative">
      <div className="fixed inset-0 -z-10" aria-hidden="true">
        <Galaxy />
      </div>

      <header
        className="sticky top-0 z-50"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: `blur(var(--glass-blur))`,
          WebkitBackdropFilter: `blur(var(--glass-blur))`,
          borderBottom: '1px solid var(--glass-border)',
          boxShadow: 'var(--shadow-premium)',
        }}
      >
        <div className="editorial-container flex items-center justify-between" style={{ paddingBlock: '0.85rem' }}>
          <div className="flex items-baseline gap-3">
            <span className="font-editorial text-3xl" style={{ color: 'var(--accent-gold)' }}>Nigran</span>
            <span className="font-accent text-[0.65rem] uppercase tracking-[0.22em]" style={{ color: 'var(--text-muted)' }}>
              Watch over Lahore
            </span>
          </div>
          <div className="flex items-center gap-3">
            <DataStatus status={risk.status} lastUpdated={risk.lastUpdated} onRetry={risk.retry} />
            <nav className="flex gap-1" style={{ marginRight: '0.5rem' }}>
              {NAV.map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className="font-accent text-[0.68rem] uppercase tracking-[0.15em]"
                  style={{
                    background: view === v.id ? 'var(--accent-gold)' : 'transparent',
                    color: view === v.id ? '#fff' : 'var(--text-secondary)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: 999,
                    padding: '0.35rem 1rem',
                    cursor: 'pointer',
                    transition: 'all .3s var(--transition-lux)',
                  }}
                >
                  {v.label}
                </button>
              ))}
            </nav>
            <button
              type="button"
              className="btn-lux btn-lux-outline"
              style={{ padding: '0.35rem 0.9rem', fontSize: '0.65rem' }}
              onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
            >
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </div>
      </header>

      <main>
        {view === 'citizen' && (
          <CitizenView
            risk={risk}
            selectedZone={selectedZone}
            onSelectZone={(z) => setZoneId(z.id)}
            showCool={showCool}
            onToggleCool={() => setShowCool(s => !s)}
            onSwitch={() => setView('ops')}
          />
        )}
        {view === 'ops' && (
          <FieldOpsView
            risk={risk}
            done={done}
            onComplete={onComplete}
            onSwitch={() => setView('citizen')}
          />
        )}
        {view === 'overview' && (
          <CityOverviewView
            risk={risk}
            done={done}
            onOpenZone={onOpenZone}
            onNavigate={setView}
          />
        )}
      </main>

      <footer className="py-10 text-center font-accent text-[0.65rem] uppercase tracking-[0.25em]" style={{ color: 'var(--text-muted)' }}>
        Nigran — hyperlocal decision intelligence for Lahore · Seadline Hackathon 2026
      </footer>

      <div className="noise-overlay" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />
    </div>
  )
}

export default App
