import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import CitizenView from './components/CitizenView.jsx'
import FieldOpsView from './components/FieldOpsView.jsx'
import CityOverviewView from './components/CityOverviewView.jsx'
import DataStatus from './components/DataStatus.jsx'
import CoutureSparkles from './components/CoutureSparkles.jsx'
import { useCityRisk } from './hooks/useCityRisk.js'
import { useLocalStorageState } from './hooks/useLocalStorageState.js'
import { ZONES } from './data/lahore.js'

// Decorative background layers, split out of the main bundle. They pull in
// `ogl` and `three` — by far the heaviest dependencies — and none of them is
// load-bearing: the map, the risk engine and every data path work without them.
// Deferring them keeps the first paint fast on a phone with a slow connection.
const Galaxy = lazy(() => import('./Galaxy.jsx'))
const LiquidEther = lazy(() => import('./components/LiquidEther.jsx'))

const NAV = [
  { id: 'citizen', label: 'Citizen' },
  { id: 'ops', label: 'Field Ops' },
  { id: 'overview', label: 'City Overview' },
]

function App() {
  const [view, setView] = useLocalStorageState('nigran-view', 'citizen')
  const [zoneId, setZoneId] = useLocalStorageState('nigran-zone', 'shahdara')
  const [showCool, setShowCool] = useLocalStorageState('nigran-cool', true)
  const [done, setDone] = useLocalStorageState('nigran-done', {})
  const [doneAt, setDoneAt] = useLocalStorageState('nigran-done-at', {})
  const [assignments, setAssignments] = useLocalStorageState('nigran-crews', {})
  const [scrolled, setScrolled] = useState(false)

  const risk = useCityRisk(done, doneAt, zoneId)
  const selectedZone = ZONES.find(z => z.id === zoneId) ?? ZONES[0]

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const onComplete = (id) => {
    const at = Date.now()
    setDone(d => ({ ...d, [id]: true }))
    setDoneAt(a => ({ ...a, [id]: at }))
  }
  // Assigning a drain to a crew. Passing a falsy crewId clears the assignment,
  // so "unassign" is the same call as "assign to nobody".
  const onAssign = (drainId, crewId) => {
    setAssignments(a => {
      const next = { ...a }
      if (crewId) next[drainId] = crewId
      else delete next[drainId]
      return next
    })
  }
  const doneIds = useMemo(() => Object.keys(done).filter(k => done[k]), [done])
  const onOpenZone = (id) => {
    setZoneId(id)
    setView('citizen')
  }

  const etherColors = ['#04A8E1', '#60C2EB', '#0B2A3C']

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      {/* ===== Layered atmosphere (sample-faithful stack) ===== */}
      {/* 1. Galaxy starfield — deepest layer */}
      <div className="fixed inset-0 -z-20" aria-hidden="true">
        <Suspense fallback={null}>
          <Galaxy />
        </Suspense>
      </div>

      {/* 2. LiquidEther mouse-reactive fluid — the sample's signature background */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        aria-hidden="true"
        style={{ opacity: 0.5 }}
      >
        <Suspense fallback={null}>
          <LiquidEther
            colors={etherColors}
            mouseForce={15}
            cursorSize={70}
            isViscous={false}
            iterationsPoisson={8}
            resolution={0.25}
            isBounce={false}
            autoDemo
            autoSpeed={0.35}
            autoIntensity={2.0}
            takeoverDuration={0.25}
            autoResumeDelay={3000}
            autoRampDuration={0.6}
          />
        </Suspense>
      </div>

      {/* 3. Mouse-parallax cyan sparkles */}
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
        <CoutureSparkles theme="dark" />
      </div>

      {/* 4. Ambient colored light blobs */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
        <motion.div
          animate={{ x: [0, 80, -40, 0], y: [0, -60, 50, 0], scale: [1, 1.2, 0.9, 1] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          className="ambient-blob"
          style={{ top: '12%', left: '18%', width: 350, height: 350, background: 'rgba(4, 168, 225, 0.22)' }}
        />
        <motion.div
          animate={{ x: [0, -70, 60, 0], y: [0, 80, -40, 0], scale: [1, 0.9, 1.15, 1] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          className="ambient-blob"
          style={{ top: '30%', right: '14%', width: 400, height: 400, background: 'rgba(96, 194, 235, 0.16)' }}
        />
      </div>

      {/* ===== Navbar — sample navbar-glass language ===== */}
      <header className={`fixed top-0 left-0 right-0 w-full z-50 navbar-glass ${scrolled ? 'scrolled' : ''} transition-all duration-300`}>
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
          </div>
        </div>
      </header>

      <main style={{ paddingTop: '4.2rem', position: 'relative', zIndex: 1 }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            {view === 'citizen' && (
              <CitizenView
                risk={risk}
                selectedZone={selectedZone}
                onSelectZone={(z) => setZoneId(z.id)}
                showCool={showCool}
                onToggleCool={() => setShowCool(s => !s)}
                onSwitch={() => setView('ops')}
                servicedIds={doneIds}
              />
            )}
            {view === 'ops' && (
              <FieldOpsView
                risk={risk}
                done={done}
                onComplete={onComplete}
                assignments={assignments}
                onAssign={onAssign}
                onSwitch={() => setView('citizen')}
                servicedIds={doneIds}
                selectedZone={selectedZone}
                onSelectZone={(z) => setZoneId(z.id)}
              />
            )}
            {view === 'overview' && (
              <CityOverviewView
                risk={risk}
                done={done}
                onOpenZone={onOpenZone}
                onNavigate={setView}
                servicedIds={doneIds}
                selectedZone={selectedZone}
                onSelectZone={(z) => setZoneId(z.id)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="py-10 text-center font-accent text-[0.65rem] uppercase tracking-[0.25em] relative z-[1]" style={{ color: 'var(--text-muted)' }}>
        Nigran — hyperlocal decision intelligence for Lahore · Seadline Hackathon 2026
      </footer>

      <div className="vignette" aria-hidden="true" />
    </div>
  )
}

export default App
