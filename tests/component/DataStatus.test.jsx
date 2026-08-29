import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DataStatus from '../../src/components/DataStatus.jsx'

describe('DataStatus', () => {
  it('shows the loading state', () => {
    render(<DataStatus status="loading" lastUpdated={null} onRetry={() => {}} />)
    expect(screen.getByText(/Fetching live data/i)).toBeInTheDocument()
  })

  it('shows live with a timestamp', () => {
    const ts = new Date('2026-08-29T10:05:00')
    render(<DataStatus status="live" lastUpdated={ts} onRetry={() => {}} />)
    expect(screen.getByText(/Live/)).toBeInTheDocument()
    expect(screen.getByText(/10:05/)).toBeInTheDocument()
    expect(screen.queryByText(/Retry/i)).not.toBeInTheDocument()
  })

  it('shows stale cache with a retry action', () => {
    render(<DataStatus status="stale" lastUpdated={new Date('2026-08-29T09:00:00')} onRetry={() => {}} />)
    expect(screen.getByText(/Stale cache/)).toBeInTheDocument()
    expect(screen.getByText(/Retry/i)).toBeInTheDocument()
  })

  it('shows snapshot mode when offline', () => {
    render(<DataStatus status="offline" lastUpdated={null} onRetry={() => {}} />)
    expect(screen.getByText(/Snapshot mode/i)).toBeInTheDocument()
    expect(screen.getByText(/Retry/i)).toBeInTheDocument()
  })
})
