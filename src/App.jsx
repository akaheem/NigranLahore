import { useEffect, useLayoutEffect, useState, useMemo, useRef, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import CitizenView from './components/CitizenView.jsx'
import FieldOpsView from './components/FieldOpsView.jsx'
import CityOverviewView from './components/CityOverviewView.jsx'
import ComplaintsView from './components/ComplaintsView.jsx'
import DataStatus from './components/DataStatus.jsx'
import CoutureSparkles from './components/CoutureSparkles.jsx'
import { useCityRisk } from './hooks/useCityRisk.js'
import { useServiceLog } from './hooks/useServiceLog.js'
import { useComplaints } from './hooks/useComplaints.js'
import { useLocalStorageState } from './hooks/useLocalStorageState.js'
import { ZONES } from './data/lahore.js'
import { REAL_TIME } from './data/telemetry.js'

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
  { id: 'complaints', label: 'Complaints' },
]

function App() {
  const [view, setView] = useLocalStorageState('nigran-view', 'citizen')
  const [zoneId, setZoneId] = useLocalStorageState('nigran-zone', 'shahdara')
  const [showCool, setShowCool] = useLocalStorageState('nigran-cool', true)
  const [assignments, setAssignments] = useLocalStorageState('nigran-crews', {})
  const [scrolled, setScrolled] = useState(false)

  // The service record replaces the old permanent `done` boolean. There is no
  // "serviced" flag to keep in sync any more: a drain's state is derived from
  // its fill, so it reopens by itself as it refills.
  const { log: serviceLog, record: recordService, sync } = useServiceLog()

  // One board, held here rather than inside the Complaints view, because the
  // City Overview draws the same reports as counts on the map. Two instances of
  // this hook would mean two IndexedDB stores and two independently-fetched
  // feeds, and the map and the board would be free to disagree.
  const board = useComplaints()

  const risk = useCityRisk(serviceLog, zoneId)
  const selectedZone = ZONES.find(z => z.id === zoneId) ?? ZONES[0]

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light')
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Each view here is a whole page, but the window keeps its scroll offset
  // across a `setView` — so switching views from halfway down a long page
  // dropped the reader into the middle of a page they had not seen the top of,
  // and they had to scroll back up to find out what they were looking at. A
  // change of view is a change of page, so it starts at the top.
  //
  // Layout effect rather than effect: this has to land before the browser
  // paints the incoming view, or the new page is briefly shown at the old
  // offset and then jumps.
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [view])

  const headerRef = useRef(null)

  /**
   * Publish the navbar's real height, and let `main` reserve exactly that much.
   *
   * The header's height is content-driven, not stated anywhere: 66px with the
   * wordmark, the tagline, the status chip and the four views all on one line
   * (measured 65.98px at 1024px), and ~108px at phone widths, where the tagline
   * is hidden and the nav drops to a row of its own (measured 108.47px at 390px;
   * it was 96px before the tagline stopped wrapping). `main` used to reserve a
   * hardcoded `4.2rem` (67.2px), which happened to match the one-line case to
   * within 1.2px and nothing else — so at every viewport under 1100px the top of
   * the page sat *underneath* an opaque navbar, by 16px on a tablet and 28px on
   * a phone.
   * Nothing caught it because `main`'s offset and the header's height were two
   * numbers that agreed only at the width the desktop captures use.
   *
   * Measured rather than declared per breakpoint, because a second number is a
   * second thing to keep in step, and this one would have to track the
   * tagline's line count, whether the nav wrapped, and which serif the browser
   * actually loaded. The observer cannot feed back into itself: the header is
   * out of flow, so nothing `main` does can change its height.
   *
   * The `4.2rem` fallback in `main` covers the first paint, before this runs.
   */
  useEffect(() => {
    const el = headerRef.current
    if (!el) return undefined
    const publish = () => {
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`)
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const onComplete = (id) => {
    // The serviced timestamp has to be read off the same clock the drain model
    // reads, or the model subtracts a wall-clock instant from a simulated one
    // and the drain reports hours of refill the moment you click it. In
    // real-time mode simNow() IS the wall clock, to the millisecond.
    const drain = risk.drainNodes.find(n => n.id === id)
    const simulated = risk.speed !== REAL_TIME
    recordService(id, {
      at: risk.simNow(),
      // Recorded so the shared log can keep this out of the published count:
      // a time-lapse session must not read as real maintenance history.
      simulated,
      speed: simulated ? risk.speed : null,
      crewId: assignments[id] ?? null,
      fillAtService: drain ? Number(drain.fillPct.toFixed(2)) : null,
    })
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
  // Which drains the map should draw as cleared. Derived from the queue rather
  // than from the log, so the map agrees with the list by construction — both
  // read the same lifecycle state.
  const servicedIds = useMemo(
    () => risk.taskQueue.filter(t => t.state === 'serviced').map(t => t.id),
    [risk.taskQueue],
  )
  const onOpenZone = (id) => {
    setZoneId(id)
    setView('citizen')
  }

  // Emerald only — the reference has no blue at all. Kept very faint (see the
  // wrapper opacity below) so the page still reads as flat white.
  const etherColors = ['#009865', '#4FC79B', '#007A55']

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      {/* ===== Layered atmosphere =====
          Four layers, all kept — but tuned so they read as depth behind the
          interface rather than as a haze over it. The haze had a specific
          cause beyond these numbers: `.vignette` was sitting at z-index 900,
          above `main` and the header, quietly veiling every card on the page.
          That is fixed in index.css. What remains here is the balance.

          Every layer stays below z-index 1, which is where `main` starts. */}
      {/* 1. Galaxy starfield — deepest layer. Desaturated further: at 0.55 the
          star colours competed with the emerald accent on a white page. */}
      <div className="fixed inset-0 -z-20" aria-hidden="true">
        <Suspense fallback={null}>
          <Galaxy saturation={0.32} />
        </Suspense>
      </div>

      {/* 2. LiquidEther mouse-reactive fluid — the signature background.
          Opacity down from 0.18 to 0.11, and masked to fade out by ~78% of the
          viewport height. The fluid is at its best behind the header where the
          page is empty; where the cards are, it was only ever adding grey. */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        aria-hidden="true"
        style={{
          opacity: 0.11,
          maskImage: 'linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.5) 40%, transparent 78%)',
          WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.5) 40%, transparent 78%)',
        }}
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

      {/* 3. Mouse-parallax emerald sparkles */}
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
        <CoutureSparkles theme="light" />
      </div>

      {/* 4. Ambient coloured light blobs — softened, so they lift the ground
          instead of tinting it. */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
        <motion.div
          animate={{ x: [0, 80, -40, 0], y: [0, -60, 50, 0], scale: [1, 1.2, 0.9, 1] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          className="ambient-blob"
          style={{ top: '12%', left: '18%', width: 350, height: 350, background: 'rgba(0, 152, 101, 0.03)' }}
        />
        <motion.div
          animate={{ x: [0, -70, 60, 0], y: [0, 80, -40, 0], scale: [1, 0.9, 1.15, 1] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          className="ambient-blob"
          style={{ top: '30%', right: '14%', width: 400, height: 400, background: 'rgba(0, 122, 85, 0.03)' }}
        />
      </div>

      {/* ===== Navbar — sample navbar-glass language =====
          Wraps below `lg` rather than running off the right edge. It used to be
          a single `justify-between` row with no wrap, so at 390px the four view
          names overflowed a 342px content band and were simply clipped: the
          document did not scroll, "Field Ops" rendered as "Field / Ops" over two
          lines, and City Overview and Complaints could not be reached at all.
          `ml-auto` on the status group and `basis-full` on the nav reproduce the
          desktop arrangement exactly — status and nav together at the right —
          while giving the nav a clean full-width row once it no longer fits.

          `lg:flex-nowrap` is the other half of that trade, and it is not
          cosmetic. Above the breakpoint the row has to be one line, so an
          overflow must land somewhere, and wrapping is the wrong answer: it
          doubles the header. Measured at 1024px in the loading state, the row's
          children want 880.88px of a 896px content box — 15px of slack. Google
          Fonts is fetched with `display=swap` and the `load` event does not wait
          for the font files, so for the first frames the wordmark renders in
          Georgia instead, and the children want 906.55px; `flex-wrap: wrap`
          answered that by dropping the nav to a second row and taking the header
          from 65.98 to 109.77. The same thing happens permanently on a network
          that cannot reach fonts.gstatic.com. With `nowrap` the 10.55px goes
          into the container's own 64px side padding, where nothing is clipped
          and no pill leaves the viewport. */}
      <header ref={headerRef} className={`fixed top-0 left-0 right-0 w-full z-50 navbar-glass ${scrolled ? 'scrolled' : ''} transition-all duration-300`}>
        <div className="editorial-container flex flex-wrap lg:flex-nowrap items-center gap-x-4 gap-y-2" style={{ paddingBlock: '0.85rem' }}>
          <div className="flex items-baseline gap-3">
            <span className="font-editorial text-3xl lg:text-4xl" style={{ color: 'var(--accent-gold-dark)', fontWeight: 700, lineHeight: 1.05 }}>Nigran</span>
            {/* Kept only where the row has room for it — below `lg` it is hidden
                outright, because it would claim a row of its own. The phone header
                already pays 108px for the nav's row, against 66px for the whole
                header on one line at `lg`, and the header is the one thing every
                view pays for. The wordmark still carries the brand; this is the
                decorative half. `whitespace-nowrap` is load-bearing: without it
                the tagline folds to three lines, which is what took the header to
                96px before. */}
            <span className="label-micro tracking-display hidden lg:inline whitespace-nowrap">
              Watch over Lahore
            </span>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {/* The time-lapse is turned on in Field Ops but it moves the whole
                app, so it says so here too — otherwise the numbers race on the
                other two views with nothing on screen to explain why. */}
            {risk.speed !== REAL_TIME && (
              <span className="eyebrow" title={`Drain telemetry is running on a clock ${risk.speed}x faster than the wall clock`}>
                Time-lapse
              </span>
            )}
            <DataStatus status={risk.status} lastUpdated={risk.lastUpdated} onRetry={risk.retry} />
          </div>
          <nav className="nav-row flex items-center gap-1 basis-full lg:basis-auto lg:mr-2">
            {NAV.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className="nav-pill"
                style={{
                  // Active nav is a mint pill with deep-emerald text, and the
                  // inactive items are plain text with no border — the
                  // reference's nav treatment exactly. The old outline on
                  // every unselected item read as a row of buttons.
                  //
                  // Only the two dynamic properties stay inline; the geometry
                  // lives in `.nav-pill` so it can answer to a breakpoint, which
                  // an inline style cannot.
                  background: view === v.id ? 'var(--accent-gold-light)' : 'transparent',
                  color: view === v.id ? 'var(--accent-gold-dark)' : 'var(--text-secondary)',
                }}
              >
                {v.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ paddingTop: 'var(--header-h, 4.2rem)', position: 'relative', zIndex: 1 }}>
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
                servicedIds={servicedIds}
              />
            )}
            {view === 'ops' && (
              <FieldOpsView
                risk={risk}
                onComplete={onComplete}
                assignments={assignments}
                onAssign={onAssign}
                onSwitch={() => setView('citizen')}
                servicedIds={servicedIds}
                selectedZone={selectedZone}
                onSelectZone={(z) => setZoneId(z.id)}
                speed={risk.speed}
                onSetSpeed={risk.setSpeed}
                serviceSync={sync}
                board={board}
              />
            )}
            {view === 'overview' && (
              <CityOverviewView
                risk={risk}
                onOpenZone={onOpenZone}
                onNavigate={setView}
                servicedIds={servicedIds}
                selectedZone={selectedZone}
                onSelectZone={(z) => setZoneId(z.id)}
                complaintCounts={board.counts}
                complaints={board.complaints}
              />
            )}
            {view === 'complaints' && (
              <ComplaintsView
                board={board}
                selectedZone={selectedZone}
                onNavigate={setView}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="site-footer">
        Nigran — hyperlocal decision intelligence for Lahore · Seadline Hackathon 2026
      </footer>

      <div className="vignette" aria-hidden="true" />
    </div>
  )
}

export default App
