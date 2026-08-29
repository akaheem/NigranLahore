import { useEffect, useState } from 'react'
import Galaxy from './Galaxy.jsx'
import CitizenView from './components/CitizenView.jsx'
import FieldOpsView from './components/FieldOpsView.jsx'

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('raah-theme') || 'dark')
  const [view, setView] = useState('citizen')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('raah-theme', theme)
  }, [theme])

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
            <span className="font-editorial text-3xl" style={{ color: 'var(--accent-gold)' }}>Raah</span>
            <span className="font-accent text-[0.65rem] uppercase tracking-[0.22em]" style={{ color: 'var(--text-muted)' }}>
              Know the safe Raah
            </span>
          </div>
          <div className="flex items-center gap-3">
            <nav className="flex gap-1" style={{ marginRight: '0.5rem' }}>
              {[
                { id: 'citizen', label: 'Citizen' },
                { id: 'ops', label: 'Field Ops' },
              ].map(v => (
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
        {view === 'citizen'
          ? <CitizenView onSwitch={() => setView('ops')} />
          : <FieldOpsView onSwitch={() => setView('citizen')} />}
      </main>

      <footer className="py-10 text-center font-accent text-[0.65rem] uppercase tracking-[0.25em]" style={{ color: 'var(--text-muted)' }}>
        Raah — hyperlocal decision intelligence for Lahore · Seadline Hackathon 2026
      </footer>

      <div className="noise-overlay" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />
    </div>
  )
}

export default App
