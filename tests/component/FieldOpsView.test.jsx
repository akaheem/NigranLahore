import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import FieldOpsView from '../../src/components/FieldOpsView.jsx'
import { buildRisk, buildTaskQueue } from '../helpers/riskFixtures.js'

vi.mock('../../src/components/CityMap.jsx', () => ({
  default: () => <div data-testid="city-map" />,
}))

const renderView = (risk = buildRisk(), props = {}) =>
  render(
    <FieldOpsView
      risk={risk}
      onComplete={vi.fn()}
      onSwitch={vi.fn()}
      {...props}
    />,
  )

/**
 * A queue where the named drains have just been cleared: sitting at the cleared
 * level, closed, unranked, and sorted below the open work — which is what
 * `useCityRisk` derives from the same two rules. Built by mapping the fixture
 * rather than hand-writing a queue, so this can't drift from the real shape.
 */
const queueAfterService = (ids, hoursAgo = 2) => {
  const now = Date.now()
  const queue = buildTaskQueue().map(t =>
    ids.includes(t.id)
      ? {
        ...t,
        fillPct: 5,
        lastServiceHrs: hoursAgo,
        lastServiceAt: now - hoursAgo * 3600_000,
        serviceCount: 1,
        serviceEvents: [{ id: `e-${t.id}`, at: now - hoursAgo * 3600_000, simulated: false, crewId: null, fillAtService: 91.4 }],
        state: 'serviced',
        open: false,
      }
      : t,
  )
  return queue.sort((a, b) => (a.open === b.open ? b.priority - a.priority : a.open ? -1 : 1))
}

// The queue row's subtitle carries "fill NN.NN% (simulated)" — the one line
// that marks a card, and the anchor these tests use to find a task card.
const rowText = () => screen.getAllByText(/\(simulated\)/i)

const openFirstTask = () => {
  const card = rowText()[0].closest('.lux-card-glass')
  fireEvent.click(card)
  return card
}

describe('FieldOpsView', () => {
  beforeEach(() => {
    vi.stubGlobal('open', vi.fn())
  })

  it('renders 8 tasks ranked in queue order', () => {
    renderView()
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('08')).toBeInTheDocument()
  })

  it('shows the real population in the why-now line (190k for Shahdara)', () => {
    renderView()
    openFirstTask()
    expect(screen.getByText(/population 190k exposed/i)).toBeInTheDocument()
  })

  it('re-ranks the remaining work once the top drain is cleared', () => {
    const top = buildTaskQueue()[0].id
    // 8 drains, one cleared → 7 open, so the last rank is 07 and 08 is gone.
    const risk = buildRisk({ taskQueue: queueAfterService([top]) })
    const onComplete = vi.fn()

    render(<FieldOpsView risk={risk} onComplete={onComplete} onSwitch={vi.fn()} />)
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.queryByText('08')).not.toBeInTheDocument()

    // openFirstTask() opens the card itself — clicking the result again would
    // toggle the drawer straight back shut.
    openFirstTask()
    fireEvent.click(screen.getByText(/Mark serviced/i))
    expect(onComplete).toHaveBeenCalledWith(risk.taskQueue[0].id)
  })

  it('opens Google Maps for the task on Navigate', () => {
    renderView()
    openFirstTask()
    fireEvent.click(screen.getByText(/Navigate/i))
    expect(window.open).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/www\.google\.com\/maps\?q=/),
      '_blank',
      'noopener',
    )
  })

  it('shows an em-dash rain counter when forecast is missing', () => {
    renderView(buildRisk({ rain6hMm: null }))
    const rainCard = screen.getByText('Rain 6h').closest('.lux-card-glass')
    expect(rainCard.textContent).toContain('—')
  })

  it('renders the completion impact with real tonnage + residents', () => {
    renderView()
    expect(screen.getByText(/Completion impact/i)).toBeInTheDocument()
    expect(screen.getByText(/residents from ponding/i)).toBeInTheDocument()
    expect(screen.getByText(/tons/)).toBeInTheDocument()
  })

  it('cites the sore-point record', () => {
    renderView()
    expect(screen.getByText(/WASA tracks 55/)).toBeInTheDocument()
  })
})

describe('FieldOpsView — crew roster', () => {
  // The card's own note opens with "Crew roster is a prototype model", so a
  // plain /Crew roster/i matches two nodes. Anchor on the heading.
  const roster = () => screen.getByText(/^Crew roster(?! is)/).closest('.lux-card-glass')

  it('lists every crew with depot, shift and load', () => {
    renderView()
    const text = roster().textContent
    expect(text).toContain('Crew Alpha')
    expect(text).toContain('Shahdara Depot · 06:00')
    expect(text).toMatch(/0\/3/)
    expect(text).toMatch(/0\/2/) // Crew Charlie runs a shorter two-task shift
    expect(text).not.toMatch(/Over capacity/)
  })

  it('counts only the open tasks assigned to each crew', () => {
    renderView(buildRisk(), { assignments: { d1: 'crew-1', d3: 'crew-1', d8: 'crew-1' } })
    expect(roster().textContent).toMatch(/3\/3/)
    expect(roster().textContent).not.toMatch(/Over capacity/)
  })

  it('excludes serviced tasks from the load', () => {
    const risk = buildRisk({ taskQueue: queueAfterService(['d1', 'd3']) })
    renderView(risk, { assignments: { d1: 'crew-1', d3: 'crew-1', d8: 'crew-1' } })
    expect(roster().textContent).toMatch(/1\/3/)
  })

  it('flags a crew that is over its shift capacity', () => {
    renderView(buildRisk(), { assignments: { d1: 'crew-1', d3: 'crew-1', d2: 'crew-1', d8: 'crew-1' } })
    expect(roster().textContent).toMatch(/4\/3/)
    expect(roster().textContent).toMatch(/Over capacity/)
  })

  it('states plainly that the roster is a model', () => {
    renderView()
    expect(roster().textContent).toMatch(/prototype model/i)
    expect(roster().textContent).toMatch(/no live WASA\/LWMC integration/i)
  })
})

describe('FieldOpsView — assignment', () => {
  beforeEach(() => {
    vi.stubGlobal('open', vi.fn())
  })

  it('offers the assign control on an open task', () => {
    renderView()
    const card = openFirstTask()
    expect(within(card).getByLabelText(/Assign crew/i)).toBeInTheDocument()
  })

  it('reports the assignment to the caller, keeping onComplete single-argument', () => {
    const risk = buildRisk()
    const onAssign = vi.fn()
    renderView(risk, { onAssign })
    const card = openFirstTask()
    fireEvent.change(within(card).getByLabelText(/Assign crew/i), { target: { value: 'crew-2' } })
    expect(onAssign).toHaveBeenCalledWith(risk.taskQueue[0].id, 'crew-2')
  })

  it('suggests the nearest depot for the top task', () => {
    // d1 is the Shahdara trunk drain; Crew Alpha is based at Shahdara Depot.
    renderView()
    const card = openFirstTask()
    expect(within(card).getByText(/Suggested: Crew Alpha/)).toBeInTheDocument()
  })

  it('shows the assigned crew on the queue row', () => {
    renderView(buildRisk(), { assignments: { d1: 'crew-2' } })
    const card = rowText()[0].closest('.lux-card-glass')
    expect(card.textContent).toContain('Crew Bravo')
  })

  it('drops the suggestion once that crew is the assignment', () => {
    renderView(buildRisk(), { assignments: { d1: 'crew-1' } })
    const card = openFirstTask()
    expect(within(card).queryByText(/Suggested:/)).not.toBeInTheDocument()
    expect(within(card).getByText(/depot Shahdara Depot/)).toBeInTheDocument()
  })

  it('lets a crew be unassigned', () => {
    const onAssign = vi.fn()
    renderView(buildRisk(), { assignments: { d1: 'crew-2' }, onAssign })
    const card = openFirstTask()
    fireEvent.change(within(card).getByLabelText(/Assign crew/i), { target: { value: '' } })
    expect(onAssign).toHaveBeenCalledWith('d1', '')
  })

  it('works without an onAssign handler', () => {
    renderView()
    const card = openFirstTask()
    expect(() => fireEvent.change(within(card).getByLabelText(/Assign crew/i), { target: { value: 'crew-3' } })).not.toThrow()
  })
})

describe('FieldOpsView — service lifecycle', () => {
  const cardFor = (name) => screen.getByText(name).closest('.lux-card-glass')

  it('badges each drain with the lifecycle state its fill implies', () => {
    renderView()
    // Seeds: d1 at 87% and d3 at 81% are past the critical line.
    expect(within(cardFor('Drain D-1 Shahdara Trunk')).getByText('Critical')).toBeInTheDocument()
    expect(within(cardFor('Drain D-8 Township')).getByText('Due')).toBeInTheDocument()
    // Nothing in the seed data has seized up yet.
    expect(screen.queryByText('Blocked — must service')).not.toBeInTheDocument()
  })

  it('badges a drain that has stopped draining as blocked', () => {
    const queue = buildTaskQueue().map(t => (t.id === 'd1' ? { ...t, fillPct: 95, state: 'blocked' } : t))
    renderView(buildRisk({ taskQueue: queue }))
    expect(within(cardFor('Drain D-1 Shahdara Trunk')).getByText('Blocked — must service')).toBeInTheDocument()
    // counted in its own tile, not lumped in with "critical"
    const tile = screen.getByText('Blocked').closest('.lux-card-glass')
    expect(tile.textContent).toContain('1')
  })

  it('drops a cleared drain out of the queue and says when it returns', () => {
    const risk = buildRisk({ taskQueue: queueAfterService(['d1']) })
    renderView(risk)
    const card = cardFor('Drain D-1 Shahdara Trunk')

    // No rank and no service button — it is not work. The card carries its own
    // countdown, and opening it states the rule that brings it back.
    expect(card.textContent).toMatch(/reopens at 40%/)
    expect(card.textContent).toMatch(/serviced 1×/)
    fireEvent.click(card)
    expect(within(card).getByText(/Cleared — refilling/)).toBeInTheDocument()
    expect(within(card).queryByText(/Mark serviced/i)).not.toBeInTheDocument()

    expect(screen.getByText('07')).toBeInTheDocument()
    expect(screen.queryByText('08')).not.toBeInTheDocument()
    // and it has sunk below the open work
    expect(rowText()[0].closest('.lux-card-glass').textContent).not.toContain('Drain D-1')
  })

  it('keeps a never-serviced drain in the queue and never calls it serviced', () => {
    renderView()
    // D-6's calibrated seed is 35% — under the 40% line, but it has never been
    // cleared, so it is work waiting, not work done.
    const card = cardFor('Drain D-6 DHA Canal Rd')
    expect(within(card).getByText('Due')).toBeInTheDocument()
    expect(within(card).queryByText('Recently serviced')).not.toBeInTheDocument()
    fireEvent.click(card)
    expect(within(card).getByLabelText(/Assign crew/i)).toBeInTheDocument()
  })

  it('states how many times a drain has been serviced', () => {
    const queue = buildTaskQueue().map(t => (t.id === 'd2' ? { ...t, serviceCount: 4 } : t))
    renderView(buildRisk({ taskQueue: queue }))
    expect(cardFor('Drain D-2 Shadbagh').textContent).toMatch(/serviced 4×/)
    expect(cardFor('Drain D-8 Township').textContent).not.toMatch(/serviced \d/)
  })

  it('lists the service history, tagging events made on the simulated clock', () => {
    const queue = buildTaskQueue().map(t => (t.id === 'd1' ? {
      ...t,
      serviceCount: 1,
      serviceEvents: [
        { id: 'e1', at: Date.parse('2026-03-04T09:30:00Z'), simulated: false, crewId: 'crew-1', fillAtService: 91.4 },
        { id: 'e2', at: Date.parse('2026-03-04T10:30:00Z'), simulated: true, crewId: null, fillAtService: 88 },
      ],
    } : t))
    renderView(buildRisk({ taskQueue: queue }))
    const card = cardFor('Drain D-1 Shahdara Trunk')
    fireEvent.click(card)

    expect(card.textContent).toMatch(/Service history — 1 counted, 1 simulated/)
    expect(card.textContent).toMatch(/cleared at 91\.4%/)
    expect(card.textContent).toMatch(/Crew Alpha/)
    // A time-lapse service is shown but never counted as real maintenance.
    expect(card.textContent).toMatch(/simulated clock, not counted/)
  })

  it('says where the service history actually lives', () => {
    renderView()
    expect(screen.getByText(/stored in this browser only/i)).toBeInTheDocument()
  })

  it('says so when the shared log is unreachable', () => {
    renderView(buildRisk(), { serviceSync: 'error' })
    expect(screen.getByText(/Shared log unreachable/i)).toBeInTheDocument()
  })

  it('does not claim there is no shared log while one is still connecting', () => {
    // The pending state must not fall through to the local-only wording: that
    // would assert no shared log is configured, which is the opposite of true.
    renderView(buildRisk(), { serviceSync: 'pending' })
    expect(screen.getByText(/Connecting to the shared log/i)).toBeInTheDocument()
    expect(screen.queryByText(/no shared log is configured/i)).not.toBeInTheDocument()
  })
})

describe('FieldOpsView — simulation clock', () => {
  // The time-lapse note. Its phrases are broken up by <strong>/<em>, and
  // getByText reads only an element's OWN text nodes, so a phrase spanning one
  // of those tags can never be found by query. Match the whole paragraph.
  const lapseNote = () => screen.getByText(/Time-lapse on/i).closest('p')

  it('offers exactly two clock modes, and starts on real time', () => {
    renderView()
    const group = screen.getByRole('group', { name: /simulation clock/i })
    expect(within(group).getAllByRole('button')).toHaveLength(2)
    expect(within(group).getByRole('button', { name: 'Real time' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: '1 min = 1 day' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports the chosen rate to the caller', () => {
    const onSetSpeed = vi.fn()
    renderView(buildRisk(), { onSetSpeed })
    fireEvent.click(screen.getByRole('button', { name: '1 min = 1 day' }))
    expect(onSetSpeed).toHaveBeenCalledWith(1440)
  })

  it('says nothing about a time-lapse while the clock is real', () => {
    renderView()
    expect(screen.queryByText(/Time-lapse on/i)).not.toBeInTheDocument()
    // Asserted against the rendered text, not by query: a queryByText for this
    // phrase would pass even with the note on screen, since <em> splits it.
    expect(document.body).not.toHaveTextContent(/not accelerated/i)
  })

  it('states the rate is unchanged and the weather is not accelerated, once it is on', () => {
    renderView(buildRisk(), { speed: 1440 })
    const note = lapseNote()
    expect(note).toHaveTextContent(/Time-lapse on/i)
    expect(note).toHaveTextContent(/11%\/day/)
    expect(note).toHaveTextContent(/not accelerated/i)
    expect(screen.getByRole('button', { name: '1 min = 1 day' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('prints fill levels to two decimals', () => {
    renderView()
    expect(rowText()[0].textContent).toMatch(/fill \d+\.\d{2}%/)
  })

  it('works without an onSetSpeed handler', () => {
    renderView()
    expect(() => fireEvent.click(screen.getByRole('button', { name: '1 min = 1 day' }))).not.toThrow()
  })
})

/**
 * The panel where a crew reads what residents are reporting near its own work.
 *
 * Two things are being guarded here, and the second matters more than the
 * first. It must show the reports in the zones this crew's drains sit in — and
 * it must be visibly ADVISORY: a claim on the panel is a claim, never a work
 * order, and nothing here may reorder the queue above it.
 */
describe('FieldOpsView — citizen reports in your zones', () => {
  const report = (over = {}) => ({
    clientId: 'c-1',
    // A report from the board that this device did not file. Nothing in this
    // view reads ownership; the field is here because the fixture mirrors the
    // record shape, and that shape carries a boolean now rather than an id.
    isMine: false,
    category: 'waterlogging',
    zoneId: 'shahdara',
    body: 'Knee-deep water outside the school gate since Tuesday morning.',
    videoUrl: null,
    createdAt: new Date().toISOString(),
    confirmations: 0,
    confirmedByMe: false,
    synced: true,
    remoteId: '7',
    photoCount: 0,
    remotePhotos: [],
    status: 'filed',
    statusKind: null,
    statusActor: null,
    statusAt: null,
    ...over,
  })

  const boardWith = (complaints, over = {}) => ({
    complaints,
    setStatus: vi.fn().mockResolvedValue({ ok: true }),
    loadPhotos: vi.fn().mockResolvedValue([]),
    loadVideo: vi.fn().mockResolvedValue(null),
    apiConfigured: false,
    ...over,
  })

  // d1 is the Shahdara trunk drain and Crew Alpha is based at Shahdara Depot,
  // which is the panel's default selection.
  const panel = () => screen.getByText(/Citizen reports in your zones/).closest('.lux-card-glass')

  it('shows a report filed in a zone this crew’s drains sit in', () => {
    renderView(buildRisk(), { board: boardWith([report()]) })
    expect(panel().textContent).toMatch(/Citizen reports in your zones — 1/)
    expect(panel().textContent).toContain('Knee-deep water outside the school gate')
  })

  it('leaves out a report from a zone this crew does not serve', () => {
    // DHA is Crew Charlie's ground, not Crew Alpha's.
    renderView(buildRisk(), { board: boardWith([report({ zoneId: 'dha' })]) })
    expect(panel().textContent).toMatch(/Citizen reports in your zones — 0/)
  })

  it('leaves out a report with no zone, which cannot be placed near any drain', () => {
    renderView(buildRisk(), { board: boardWith([report({ zoneId: null })]) })
    expect(panel().textContent).toMatch(/Citizen reports in your zones — 0/)
  })

  it('leaves out a report that already reads resolved', () => {
    renderView(buildRisk(), { board: boardWith([report({ status: 'resolved', statusKind: 'crew', statusActor: 'crew-1' })]) })
    expect(panel().textContent).toMatch(/Citizen reports in your zones — 0/)
    expect(panel().textContent).toMatch(/everything there has already been closed/)
  })

  it('offers the crew’s own half of the table, and never the resident’s', async () => {
    const board = boardWith([report()])
    renderView(buildRisk(), { board })
    const card = within(panel())
    fireEvent.click(card.getByRole('button', { name: /We've seen this/ }))

    // Attributed to the crew the panel is acting as, which is what the server
    // checks the transition against.
    expect(board.setStatus).toHaveBeenCalledWith('c-1', 'acknowledged', { kind: 'crew', actorId: 'crew-1' })
    // "It's fixed" is a resident's claim about what they can see. A crew saying
    // it would be putting words in the resident's mouth.
    expect(card.queryByRole('button', { name: "It's fixed" })).not.toBeInTheDocument()

    // The card clears its busy flag when the board's promise settles — a microtask
    // after the click. Waiting for the chip to come back keeps that update inside
    // act(); without it the continuation lands outside act and React warns.
    // `async` alone is not enough here: with no `await` in the body the test still
    // runs to completion synchronously, which is why this one warned as written.
    await waitFor(() => expect(card.getByRole('button', { name: /We've seen this/ })).toBeEnabled())
  })

  it('never offers a crew to remove a resident’s report', () => {
    renderView(buildRisk(), { board: boardWith([report()]) })
    expect(within(panel()).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
  })

  it('says on its face that the panel is advisory, and why', () => {
    renderView(buildRisk(), { board: boardWith([report()]) })
    const text = panel().textContent
    expect(text).toMatch(/Advisory only/)
    expect(text).toMatch(/never reorders the queue/)
    expect(text).toMatch(/enters a risk score/)
  })

  it('repeats the prototype framing where a claim is actually made', () => {
    renderView(buildRisk(), { board: boardWith([report({ status: 'in-progress', statusKind: 'crew', statusActor: 'crew-1' })]) })
    const text = panel().textContent
    expect(text).toMatch(/prototype model/)
    expect(text).toMatch(/not a WASA or LWMC work-order record/)
  })

  it('puts the claim on the card, named and labelled', () => {
    renderView(buildRisk(), { board: boardWith([report({ status: 'in-progress', statusKind: 'crew', statusActor: 'crew-1' })]) })
    expect(within(panel()).getByText(/is on it/)).toHaveTextContent('Crew Alpha (prototype model)')
  })

  it('reads an empty panel as empty rather than broken', () => {
    renderView(buildRisk(), { board: boardWith([]) })
    expect(panel().textContent).toMatch(/Nothing reported in the zones/)
  })

  it('works with no board at all, which is the local-only deployment', () => {
    expect(() => renderView()).not.toThrow()
    expect(panel().textContent).toMatch(/Citizen reports in your zones — 0/)
  })
})
