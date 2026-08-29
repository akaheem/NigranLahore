import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RiskCard from '../../src/components/RiskCard.jsx'

describe('RiskCard', () => {
  it('renders the title, score, and band label', () => {
    render(<RiskCard num="II" title="Why Shahdara scores 82" score={82} />)
    expect(screen.getByText('Why Shahdara scores 82')).toBeInTheDocument()
    expect(screen.getByText('82')).toBeInTheDocument()
    expect(screen.getByText('Severe')).toBeInTheDocument()
  })

  it('toggles the why list open and closed', () => {
    render(<RiskCard num="II" title="T" score={50} whys={['reason one', 'reason two']} />)
    expect(screen.queryByText('reason one')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Why this number?'))
    expect(screen.getByText('reason one')).toBeInTheDocument()
    expect(screen.getByText('reason two')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Why this number?'))
    expect(screen.queryByText('reason one')).not.toBeInTheDocument()
  })

  it('renders the footer when provided', () => {
    render(<RiskCard num="II" title="T" score={10} footer="citations live here" />)
    expect(screen.getByText('citations live here')).toBeInTheDocument()
  })
})
