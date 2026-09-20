import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import ComplaintsView from '../../src/components/ComplaintsView.jsx'
import { SYNC_LOCAL_ONLY, SYNC_SYNCED } from '../../src/hooks/useComplaints.js'
import { COMPLAINTS_NOTE, MAX_PHOTOS } from '../../src/data/complaints.js'
import { LOCATION_PRECISION_M } from '../../src/lib/geo.js'
import { downscaleImage } from '../../src/lib/complaintMedia.js'

// The browser-only half of the media pipeline. Its own maths is covered in
// tests/unit/complaintMedia.test.js; here it is a stub so the form can be
// driven without a canvas.
vi.mock('../../src/lib/complaintMedia.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downscaleImage: vi.fn(),
}))

beforeAll(() => {
  // jsdom implements neither, and the form builds a preview URL per photo.
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

const complaint = (over = {}) => ({
  clientId: 'c-1',
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
  ...over,
})

const makeBoard = (over = {}) => ({
  complaints: [],
  counts: {},
  loaded: true,
  sync: SYNC_LOCAL_ONLY,
  file: vi.fn().mockResolvedValue({}),
  confirm: vi.fn().mockResolvedValue({ ok: true }),
  remove: vi.fn().mockResolvedValue({ ok: true }),
  setStatus: vi.fn().mockResolvedValue({ ok: true }),
  flush: vi.fn().mockResolvedValue(undefined),
  loadPhotos: vi.fn().mockResolvedValue([]),
  loadVideo: vi.fn().mockResolvedValue(null),
  apiConfigured: false,
  durable: true,
  ...over,
})

const renderView = (board = makeBoard(), props = {}) =>
  render(<ComplaintsView board={board} selectedZone={{ id: 'shahdara', name: 'Shahdara' }} onNavigate={vi.fn()} {...props} />)

const describeField = () => screen.getByLabelText(/What is happening/i)

describe('ComplaintsView — the honesty line', () => {
  it('says on its face that citizen reports are unverified', () => {
    renderView()
    expect(screen.getByText(COMPLAINTS_NOTE)).toBeInTheDocument()
  })

  it('states where the reports actually live', () => {
    renderView(makeBoard({ sync: SYNC_LOCAL_ONLY }))
    expect(screen.getByText(/stored on this device only/)).toBeInTheDocument()
  })

  it('says so when the shared board is connected instead', () => {
    renderView(makeBoard({ sync: SYNC_SYNCED }))
    expect(screen.getByText(/visible to everyone using the app/)).toBeInTheDocument()
  })

  it('warns when reports will not outlive the tab', () => {
    // Safari private mode, or storage blocked. Better a line of warning than a
    // person discovering it when their report is gone.
    renderView(makeBoard({ durable: false }))
    expect(screen.getByText(/last only until you close this tab/)).toBeInTheDocument()
  })
})

describe('ComplaintsView — the empty board', () => {
  it('explains the emptiness rather than showing a blank panel', () => {
    renderView()
    expect(screen.getByText('Nothing reported yet.')).toBeInTheDocument()
    expect(screen.getByText(/no account, no queue, no waiting/)).toBeInTheDocument()
  })

  it('offers no category filters when there is nothing to filter', () => {
    renderView()
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
  })
})

describe('ComplaintsView — filing a report', () => {
  it('hands the trimmed report to the board', async () => {
    const board = makeBoard()
    renderView(board)
    fireEvent.change(describeField(), { target: { value: '  The drain is blocked and overflowing.  ' } })
    fireEvent.click(screen.getByRole('button', { name: /File this report/ }))
    // The form empties only once the report has actually been written, so the
    // assertion waits for the confirmation rather than racing it.
    await screen.findByRole('status')

    expect(board.file).toHaveBeenCalledTimes(1)
    expect(board.file.mock.calls[0][0]).toMatchObject({
      category: 'waterlogging',
      zoneId: 'shahdara',
      body: 'The drain is blocked and overflowing.',
      videoUrl: null,
    })
  })

  it('refuses a report too short for anyone to act on', () => {
    const board = makeBoard()
    renderView(board)
    fireEvent.change(describeField(), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: /File this report/ }))

    expect(board.file).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 12 characters/)
  })

  it('refuses twelve spaces, which say nothing', () => {
    const board = makeBoard()
    renderView(board)
    fireEvent.change(describeField(), { target: { value: ' '.repeat(40) } })
    fireEvent.click(screen.getByRole('button', { name: /File this report/ }))
    expect(board.file).not.toHaveBeenCalled()
  })

  it('refuses a video link that is not on the accepted platforms', () => {
    const board = makeBoard()
    renderView(board)
    fireEvent.change(describeField(), { target: { value: 'The drain is blocked and overflowing.' } })
    fireEvent.change(screen.getByLabelText(/Video link/i), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: /File this report/ }))

    expect(board.file).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/http and https/)
  })

  it('accepts a video link from YouTube', async () => {
    const board = makeBoard()
    renderView(board)
    fireEvent.change(describeField(), { target: { value: 'The drain is blocked and overflowing.' } })
    fireEvent.change(screen.getByLabelText(/Video link/i), { target: { value: 'https://youtu.be/abc123' } })
    fireEvent.click(screen.getByRole('button', { name: /File this report/ }))
    await screen.findByRole('status')

    expect(board.file).toHaveBeenCalledTimes(1)
    expect(board.file.mock.calls[0][0].videoUrl).toBe('https://youtu.be/abc123')
  })

  it('clears the form and confirms once a report is filed', async () => {
    const board = makeBoard()
    renderView(board)
    fireEvent.change(describeField(), { target: { value: 'The drain is blocked and overflowing.' } })
    fireEvent.click(screen.getByRole('button', { name: /File this report/ }))

    expect(await screen.findByRole('status')).toHaveTextContent(/Report filed/)
    expect(describeField().value).toBe('')
  })

  it('preselects the zone the citizen is already looking at', async () => {
    const board = makeBoard()
    renderView(board)
    fireEvent.change(describeField(), { target: { value: 'The drain is blocked and overflowing.' } })
    fireEvent.click(screen.getByRole('button', { name: /File this report/ }))
    await screen.findByRole('status')
    expect(board.file.mock.calls[0][0].zoneId).toBe('shahdara')
  })

  it('lets the zone be left blank, because someone may not know it', async () => {
    const board = makeBoard()
    renderView(board)
    fireEvent.change(screen.getByLabelText(/Where is it/i), { target: { value: '' } })
    fireEvent.change(describeField(), { target: { value: 'The drain is blocked and overflowing.' } })
    fireEvent.click(screen.getByRole('button', { name: /File this report/ }))
    await screen.findByRole('status')
    expect(board.file.mock.calls[0][0].zoneId).toBeNull()
  })
})

describe('ComplaintsView — photos', () => {
  const pickFile = (name = 'street.jpg') => {
    const input = document.querySelector('input[type="file"]')
    const file = new File(['bytes'], name, { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
  }

  it('compresses a picked photo and shows what is about to be sent', async () => {
    downscaleImage.mockResolvedValue({
      ok: true,
      blob: new Blob(['x'], { type: 'image/webp' }),
      bytes: 240 * 1024,
      originalBytes: 4_000_000,
      width: 1400,
      height: 1050,
    })
    renderView()
    pickFile()
    expect(await screen.findByText('240 KB')).toBeInTheDocument()
  })

  it('reports a photo it cannot read, by name, instead of dropping it quietly', async () => {
    downscaleImage.mockResolvedValue({ ok: false, error: 'IMG_1.HEIC is an HEIC/HEIF file, which browsers cannot read.' })
    renderView()
    pickFile('IMG_1.HEIC')
    expect(await screen.findByText(/HEIC\/HEIF file/)).toBeInTheDocument()
  })

  it('takes a photo back off the report', async () => {
    downscaleImage.mockResolvedValue({
      ok: true, blob: new Blob(['x'], { type: 'image/webp' }), bytes: 2048, originalBytes: 4096,
    })
    renderView()
    pickFile()
    await screen.findByText('2 KB')

    fireEvent.click(screen.getByRole('button', { name: /Remove this photo/ }))
    expect(screen.queryByText('2 KB')).not.toBeInTheDocument()
  })

  it('stops offering the picker once the photo limit is reached', async () => {
    downscaleImage.mockResolvedValue({
      ok: true, blob: new Blob(['x'], { type: 'image/webp' }), bytes: 2048, originalBytes: 4096,
    })
    renderView()
    const input = document.querySelector('input[type="file"]')
    const files = Array.from({ length: MAX_PHOTOS }, (_, i) => new File(['b'], `s-${i}.jpg`, { type: 'image/jpeg' }))
    fireEvent.change(input, { target: { files } })

    expect(await screen.findAllByRole('button', { name: /Remove this photo/ })).toHaveLength(MAX_PHOTOS)
    expect(screen.queryByText('Add photo')).not.toBeInTheDocument()
  })

  it('keeps no more than the limit even if more are handed over at once', async () => {
    downscaleImage.mockResolvedValue({
      ok: true, blob: new Blob(['x'], { type: 'image/webp' }), bytes: 2048, originalBytes: 4096,
    })
    renderView()
    const input = document.querySelector('input[type="file"]')
    const files = Array.from({ length: MAX_PHOTOS + 2 }, (_, i) => new File(['b'], `s-${i}.jpg`, { type: 'image/jpeg' }))
    fireEvent.change(input, { target: { files } })

    expect(await screen.findAllByRole('button', { name: /Remove this photo/ })).toHaveLength(MAX_PHOTOS)
  })
})

describe('ComplaintsView — the board', () => {
  it('renders a card per report', () => {
    renderView(makeBoard({
      complaints: [
        complaint({ clientId: 'c-1', body: 'Knee-deep water outside the school gate.' }),
        complaint({ clientId: 'c-2', body: 'The bin on our street has not been emptied.' }),
      ],
    }))
    expect(screen.getByText('Knee-deep water outside the school gate.')).toBeInTheDocument()
    expect(screen.getByText('The bin on our street has not been emptied.')).toBeInTheDocument()
    expect(screen.getByText(/The board — 2 reports/)).toBeInTheDocument()
  })

  it('offers a filter chip only for categories that are actually on the board', () => {
    renderView(makeBoard({ complaints: [complaint({ category: 'waste' })] }))
    expect(screen.getByRole('button', { name: /Garbage not collected/ })).toBeInTheDocument()
    // Nine chips where seven match nothing is noise, not navigation.
    expect(screen.queryByRole('button', { name: /Electricity/ })).not.toBeInTheDocument()
  })

  it('narrows the board to one category, and back', () => {
    renderView(makeBoard({
      complaints: [
        complaint({ clientId: 'c-1', category: 'waste', body: 'The bin has not been emptied.' }),
        complaint({ clientId: 'c-2', category: 'waterlogging', body: 'The underpass is flooded.' }),
      ],
    }))
    fireEvent.click(screen.getByRole('button', { name: /Garbage not collected/ }))
    expect(screen.getByText('The bin has not been emptied.')).toBeInTheDocument()
    expect(screen.queryByText('The underpass is flooded.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('The underpass is flooded.')).toBeInTheDocument()
  })

  it('says so when a filter matches nothing, and offers the way back', () => {
    renderView(makeBoard({
      complaints: [
        complaint({ clientId: 'c-1', category: 'waste', body: 'The bin has not been emptied.' }),
        complaint({ clientId: 'c-2', category: 'waterlogging', body: 'The underpass is flooded.', zoneId: 'gulberg' }),
      ],
    }))
    fireEvent.click(screen.getByRole('button', { name: /Waterlogging/ }))
    fireEvent.change(screen.getByLabelText(/Filter by zone/i), { target: { value: 'shahdara' } })
    expect(screen.getByText('No reports match that filter.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Show everything/ }))
    expect(screen.getByText('The bin has not been emptied.')).toBeInTheDocument()
  })

  it('reorders the board when the sort is switched', () => {
    renderView(makeBoard({
      complaints: [
        complaint({ clientId: 'c-1', body: 'Newer but unconfirmed.', createdAt: '2026-09-19T12:00:00.000Z', confirmations: 0 }),
        complaint({ clientId: 'c-2', body: 'Older but widely confirmed.', createdAt: '2026-09-19T09:00:00.000Z', confirmations: 9 }),
      ],
    }))
    const bodies = () => screen.getAllByRole('article').map(el => el.textContent)

    expect(bodies()[0]).toContain('Newer but unconfirmed.')
    fireEvent.click(screen.getByRole('button', { name: 'Most confirmed' }))
    expect(bodies()[0]).toContain('Older but widely confirmed.')
  })

  it('marks the active sort for assistive technology, not just in colour', () => {
    renderView()
    expect(screen.getByRole('button', { name: 'Newest' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('ComplaintsView — ownership', () => {
  it('offers Remove only on a report this device filed', () => {
    renderView(makeBoard({
      complaints: [
        complaint({ clientId: 'c-1', isMine: true, body: 'Mine.' }),
        complaint({ clientId: 'c-2', isMine: false, body: 'Theirs.' }),
      ],
    }))
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
  })

  it('removes the report this device filed', async () => {
    const board = makeBoard({
      complaints: [complaint({ clientId: 'c-1', isMine: true })],
    })
    renderView(board)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(board.remove).toHaveBeenCalledWith('c-1')

    // Same shape as the "Me too" case below: the card clears its busy flag a
    // microtask after the click, which would otherwise land outside act().
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled())
  })

  it('says the report is not on the shared board yet while it is still local', () => {
    renderView(makeBoard({
      apiConfigured: true,
      complaints: [complaint({ clientId: 'c-1', isMine: true, synced: false, remoteId: null })],
    }))
    expect(screen.getByText('Not on the shared board yet')).toBeInTheDocument()
  })

  it('marks the card this device filed, and leaves a neighbour’s unmarked', () => {
    renderView(makeBoard({
      complaints: [
        complaint({ clientId: 'c-1', isMine: true, body: 'Mine.' }),
        complaint({ clientId: 'c-2', isMine: false, body: 'Theirs.' }),
      ],
    }))

    const mine = screen.getByText('Mine.').closest('.complaint-card')
    const theirs = screen.getByText('Theirs.').closest('.complaint-card')
    expect(within(mine).getByText('Your report')).toBeInTheDocument()
    // The absence is the marker for everything else — the board is mostly other
    // people's reports, and labelling each one "not yours" would be noise.
    expect(within(theirs).queryByText('Your report')).not.toBeInTheDocument()
    expect(screen.getAllByText('Your report')).toHaveLength(1)
  })
})

/**
 * The status spine.
 *
 * A chip alone meant reading every card's header to find the two that are still
 * open. The spine carries the same colour down the whole left edge, so the
 * lifecycle reads while scrolling — and because it and the chip are painted
 * from one value, the two cannot drift into disagreeing about what "resolved"
 * looks like.
 */
describe('ComplaintsView — the status spine', () => {
  const spine = () => document.querySelector('.complaint-card').style.getPropertyValue('--status-tone').trim()
  const cardOf = () => document.querySelector('.complaint-card')

  it('gives each of the four statuses its own colour', () => {
    const tones = new Map()
    for (const status of ['filed', 'acknowledged', 'in-progress', 'resolved']) {
      const { unmount } = renderView(makeBoard({ complaints: [complaint({ status })] }))
      tones.set(status, spine())
      unmount()
    }
    expect([...tones.values()].every(Boolean)).toBe(true)
    // Four states that are distinguishable from each other. `Filed` being quiet
    // grey is deliberate — it is the state of a report nothing has touched.
    expect(new Set(tones.values()).size).toBe(4)
  })

  it('paints the spine from the same value as the chip beside it', () => {
    renderView(makeBoard({ complaints: [complaint({ status: 'in-progress' })] }))
    const tone = spine()
    expect(tone).toBe('var(--risk-moderate)')
    const chip = within(cardOf()).getByText('In progress').closest('.chip-lux')
    expect(chip.getAttribute('style')).toContain(tone)
  })

  it('moves the spine when the status moves, without a reload', () => {
    const board = makeBoard({ complaints: [complaint({ isMine: true, status: 'filed' })] })
    const { rerender } = renderView(board)
    expect(spine()).toBe('var(--text-muted)')

    rerender(
      <ComplaintsView
        board={{ ...board, complaints: [complaint({ isMine: true, status: 'resolved', statusKind: 'reporter' })] }}
        selectedZone={{ id: 'shahdara', name: 'Shahdara' }}
        onNavigate={vi.fn()}
      />,
    )
    expect(spine()).toBe('var(--accent-green-dark)')
  })
})

describe('ComplaintsView — me too', () => {
  it('records a confirmation and shows the running count', async () => {
    const board = makeBoard({ complaints: [complaint({ confirmations: 3 })] })
    renderView(board)
    expect(screen.getByText('3 people reported this')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Me too/ }))
    expect(board.confirm).toHaveBeenCalledWith('c-1')

    // The card clears its busy flag when the board's promise settles — a
    // microtask after the click, and so after this body would otherwise have
    // returned. Waiting for the button to come back keeps that update inside
    // act(); without it the continuation lands outside act and React warns.
    await waitFor(() => expect(screen.getByRole('button', { name: /Me too/ })).toBeEnabled())
  })

  it('shows a confirmed report as confirmed rather than inviting a second tap', () => {
    renderView(makeBoard({ complaints: [complaint({ confirmations: 2, confirmedByMe: true })] }))
    const button = screen.getByRole('button', { name: /You confirmed this/ })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('ComplaintsView — photos on a card', () => {
  it('opens a photo full-screen and closes it on Escape', () => {
    renderView(makeBoard({
      complaints: [complaint({ remotePhotos: ['11', '12'] })],
    }))
    fireEvent.click(screen.getByRole('button', { name: /Open photo 1 of 2/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('steps through the photos with the arrow keys', () => {
    renderView(makeBoard({ complaints: [complaint({ remotePhotos: ['11', '12'] })] }))
    fireEvent.click(screen.getByRole('button', { name: /Open photo 1 of 2/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('1 / 2')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(within(screen.getByRole('dialog')).getByText('2 / 2')).toBeInTheDocument()
  })
})

/**
 * Where a card's media actually comes from, and what it does with it.
 *
 * A report this device filed carries its own bytes; one it merely read off the
 * board carries ids. The card must play whichever it actually has, prefer its
 * own copy when it has one, and — the part that is easy to get wrong and
 * invisible when you do — hand back the object URLs it made when it goes.
 */
describe('ComplaintsView — where a card’s media comes from', () => {
  // The file-wide stub returns one constant URL, which cannot tell one blob from
  // another. These tests need distinct URLs to check what was revoked, so they
  // hand out their own and this puts the shared ones back afterwards.
  afterEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
  })

  const clipOf = () => document.querySelector('article video')

  it('shows the board’s photographs without asking this device for any', () => {
    // The report was filed elsewhere. There are no local bytes to look for, and
    // looking anyway would replace the board's photos with an empty list.
    const board = makeBoard({ complaints: [complaint({ remotePhotos: ['11', '12'] })] })
    renderView(board)

    expect(screen.getByRole('button', { name: /Open photo 1 of 2/ })).toBeInTheDocument()
    expect(board.loadPhotos).not.toHaveBeenCalled()
  })

  it('plays this device’s own photographs, and releases their URLs when the card goes', async () => {
    const handed = ['blob:one', 'blob:two']
    URL.createObjectURL = vi.fn(() => handed.shift())
    URL.revokeObjectURL = vi.fn()

    const board = makeBoard({
      complaints: [complaint({ photoCount: 2 })],
      loadPhotos: vi.fn().mockResolvedValue([{ blob: new Blob(['a']) }, { blob: new Blob(['b']) }]),
    })
    const { unmount } = renderView(board)

    expect(await screen.findByRole('button', { name: /Open photo 1 of 2/ })).toBeInTheDocument()
    unmount()

    // An object URL pins its Blob for the life of the document, and a clip blob
    // is 25 MB. Nothing else releases these.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:two')
  })

  it('plays a clip the board holds from the board’s own URL', () => {
    renderView(makeBoard({ complaints: [complaint({ hasVideo: true, videoId: '42' })] }))
    expect(clipOf()).toHaveAttribute('src', '/api/complaints/video/42')
  })

  it('plays this device’s own clip rather than fetching the board’s copy back', async () => {
    // The bytes are already on this phone. Downloading them again would spend a
    // resident's data on a file they are holding.
    URL.createObjectURL = vi.fn(() => 'blob:clip')

    const board = makeBoard({
      complaints: [complaint({ hasVideo: true, videoId: '42' })],
      loadVideo: vi.fn().mockResolvedValue(new Blob(['v'])),
    })
    renderView(board)

    await waitFor(() => expect(clipOf()).toHaveAttribute('src', 'blob:clip'))
  })

  it('falls back to the board’s clip when this device no longer holds it', async () => {
    // A cleared profile, or a different phone. A player that waits forever on
    // bytes that are gone is worse than the board's copy.
    const board = makeBoard({
      complaints: [complaint({ hasVideo: true, videoId: '42' })],
      loadVideo: vi.fn().mockResolvedValue(null),
    })
    renderView(board)

    await waitFor(() => expect(board.loadVideo).toHaveBeenCalled())
    expect(clipOf()).toHaveAttribute('src', '/api/complaints/video/42')
  })
})

/**
 * What the zone field starts on, and whose choice survives.
 *
 * The zone the citizen is looking at prefills the field, because that is the
 * zone they are most likely reporting on — but "I have not chosen" and "I have
 * chosen to name no zone" are different states, and only one of them may be
 * overruled by where they happen to be looking.
 */
describe('ComplaintsView — the zone the field starts on', () => {
  const zoneField = () => screen.getByLabelText(/Where is it/i)

  const renderAt = (zone, board = makeBoard()) =>
    render(<ComplaintsView board={board} selectedZone={zone} onNavigate={vi.fn()} />)

  const SHAHDARA = { id: 'shahdara', name: 'Shahdara' }
  const DHA = { id: 'dha', name: 'DHA' }

  it('starts on the zone the citizen is looking at', () => {
    renderAt(SHAHDARA)
    expect(zoneField()).toHaveValue('shahdara')
  })

  it('keeps an explicit "I am not sure which zone" when the viewed zone changes', () => {
    // The empty value is a real answer, not an empty field. Reading it as
    // "untouched" would silently file the report against a zone the citizen
    // explicitly declined to name.
    const board = makeBoard()
    const { rerender } = renderAt(SHAHDARA, board)
    fireEvent.change(zoneField(), { target: { value: '' } })
    expect(zoneField()).toHaveValue('')

    rerender(<ComplaintsView board={board} selectedZone={DHA} onNavigate={vi.fn()} />)
    expect(zoneField()).toHaveValue('')
  })

  it('lets a zone the citizen picked outlast the one they were looking at', () => {
    const board = makeBoard()
    const { rerender } = renderAt(SHAHDARA, board)
    fireEvent.change(zoneField(), { target: { value: 'dha' } })

    rerender(<ComplaintsView board={board} selectedZone={SHAHDARA} onNavigate={vi.fn()} />)
    expect(zoneField()).toHaveValue('dha')
  })
})

/**
 * A geolocation stub that answers at once with whatever the test hands it.
 *
 * jsdom has no geolocation at all, so every one of these tests is really about
 * what the FORM does with an answer — including the two answers that are not a
 * fix: a refusal, and a fix from somewhere that is not Lahore.
 */
const stubGeolocation = ({ coords = null, fail = false } = {}) => {
  const stub = {
    getCurrentPosition: vi.fn((ok, err) => {
      if (fail) err({ code: 1, message: 'User denied Geolocation' })
      else ok({ coords })
    }),
  }
  Object.defineProperty(window.navigator, 'geolocation', { value: stub, configurable: true })
  return stub
}

const locateButton = () => screen.getByRole('button', { name: /Use my location/ })
const pinNote = () => screen.getByRole('status')

describe('ComplaintsView — the pin is opt-in, and never exact', () => {
  afterEach(() => {
    // Defined per-test rather than globally, so the "cannot share a location"
    // case below is the real absence rather than a stub that never answers.
    Object.defineProperty(window.navigator, 'geolocation', { value: undefined, configurable: true })
  })

  const fileIt = async () => {
    fireEvent.change(describeField(), { target: { value: 'The drain is blocked and overflowing.' } })
    fireEvent.click(screen.getByRole('button', { name: /File this report/ }))
    await screen.findByText(/Report filed/)
  }

  it('files no pin at all when the button is never pressed', async () => {
    // The default. A location is not something this form helps itself to.
    const board = makeBoard()
    renderView(board)
    await fileIt()

    expect(board.file.mock.calls[0][0].lat).toBeNull()
    expect(board.file.mock.calls[0][0].lng).toBeNull()
  })

  it('snaps the fix to three decimals and says the pin is approximate', () => {
    const board = makeBoard()
    renderView(board)
    stubGeolocation({ coords: { latitude: 31.5204123, longitude: 74.3581234 } })
    fireEvent.click(locateButton())

    // The figure shown is the figure that will be stored, so nobody is asked to
    // trust that the rounding happened somewhere they cannot see.
    expect(screen.getByText('31.520, 74.358')).toBeInTheDocument()
    expect(pinNote()).toHaveTextContent(/Pinned approximately/)
    expect(pinNote()).toHaveTextContent(`about ${LOCATION_PRECISION_M} m`)
    expect(pinNote()).toHaveTextContent(/does not point at your door/)
  })

  it('hands the snapped pin to the board, not the raw fix', async () => {
    const board = makeBoard()
    renderView(board)
    stubGeolocation({ coords: { latitude: 31.5204123, longitude: 74.3581234 } })
    fireEvent.click(locateButton())
    await fileIt()

    expect(board.file.mock.calls[0][0].lat).toBe(31.52)
    expect(board.file.mock.calls[0][0].lng).toBe(74.358)
  })

  it('still files the report when permission is refused', async () => {
    // The words are the part that matters. Losing them over a coordinate the
    // person never had to give would be the wrong trade.
    const board = makeBoard()
    renderView(board)
    stubGeolocation({ fail: true })
    fireEvent.click(locateButton())

    expect(pinNote()).toHaveTextContent(/permission denied/)
    expect(screen.queryByText(/31\./, { exact: false })).not.toBeInTheDocument()

    await fileIt()
    expect(board.file).toHaveBeenCalledTimes(1)
    expect(board.file.mock.calls[0][0].lat).toBeNull()
  })

  it('places no pin for a fix that is not in Lahore, and says why', async () => {
    const board = makeBoard()
    renderView(board)
    stubGeolocation({ coords: { latitude: 51.5074, longitude: -0.1278 } })
    fireEvent.click(locateButton())

    expect(pinNote()).toHaveTextContent(/outside Lahore/)
    expect(pinNote()).toHaveTextContent(/carry its zone instead/)

    await fileIt()
    expect(board.file.mock.calls[0][0].lat).toBeNull()
  })

  it('says so when the device cannot share a location at all', () => {
    renderView()
    fireEvent.click(locateButton())
    expect(pinNote()).toHaveTextContent(/cannot share a location/)
  })

  it('lets a pin be taken back off before the report is filed', async () => {
    const board = makeBoard()
    renderView(board)
    stubGeolocation({ coords: { latitude: 31.52, longitude: 74.358 } })
    fireEvent.click(locateButton())
    fireEvent.click(screen.getByRole('button', { name: /Remove the pin/ }))

    expect(locateButton()).toBeInTheDocument()
    await fileIt()
    expect(board.file.mock.calls[0][0].lat).toBeNull()
  })

  it('never places a pin without the button being pressed, however often it re-renders', () => {
    // The guarantee is not "we ask politely" — it is that the form holds no
    // location until someone presses the button. Re-rendering must not change
    // that, which is what a stray effect would do.
    const stub = stubGeolocation({ coords: { latitude: 31.52, longitude: 74.358 } })
    const { rerender } = renderView()
    rerender(<ComplaintsView board={makeBoard()} selectedZone={{ id: 'shahdara', name: 'Shahdara' }} onNavigate={vi.fn()} />)
    expect(stub.getCurrentPosition).not.toHaveBeenCalled()
    expect(screen.queryByText('31.520, 74.358')).not.toBeInTheDocument()
  })
})

/**
 * The status chip, and the line under it that says who claimed it.
 *
 * The chip is the most authoritative-looking thing on the board, so these are
 * as much about what it refuses to say as about what it says: nobody verified
 * any of it, and a claim is attributed to whoever made it or to no one.
 */
describe('ComplaintsView — the lifecycle on a card', () => {
  const chip = (label) => screen.getByText(label)

  it('shows a report nobody has moved as Filed, with nobody credited', () => {
    renderView(makeBoard({ complaints: [complaint({ status: 'filed' })] }))
    expect(chip('Filed')).toBeInTheDocument()
    // Not "the reporter says it is still happening": a report that has never
    // been moved is not a claim by anyone, and saying otherwise would put words
    // in the filer's mouth on every card on the board.
    expect(screen.queryByText(/still happening/)).not.toBeInTheDocument()
    expect(screen.queryByText(/prototype model/)).not.toBeInTheDocument()
  })

  it('names the crew that claimed a report, and labels the roster a model', () => {
    renderView(makeBoard({
      complaints: [complaint({
        status: 'in-progress', statusKind: 'crew', statusActor: 'crew-1',
        statusAt: new Date(Date.now() - 120_000).toISOString(),
      })],
    }))

    expect(chip('In progress')).toBeInTheDocument()
    const line = screen.getByText(/is on it/)
    expect(line).toHaveTextContent('Crew Alpha (prototype model)')
    // With the time it happened, because "in progress" without a when is not a
    // fact anyone can act on.
    expect(line).toHaveTextContent(/ago/)
  })

  it('does not invent a crew name it does not have', () => {
    renderView(makeBoard({
      complaints: [complaint({ status: 'acknowledged', statusKind: 'crew', statusActor: null })],
    }))
    expect(screen.getByText(/Acknowledged by/)).toHaveTextContent('A crew (prototype model)')
  })

  it('reads a crew closing a job differently from a resident saying it is fixed', () => {
    // Both arrive at Resolved and they are not the same claim — this is the
    // distinction the whole `actor_kind` split exists to keep.
    const { unmount } = renderView(makeBoard({
      complaints: [complaint({ status: 'resolved', statusKind: 'crew', statusActor: 'crew-1' })],
    }))
    expect(screen.getByText(/Closed by/)).toHaveTextContent('Crew Alpha (prototype model)')
    unmount()

    renderView(makeBoard({
      complaints: [complaint({ status: 'resolved', statusKind: 'reporter' })],
    }))
    expect(screen.getByText(/says it is fixed/)).toHaveTextContent('The reporter says it is fixed')
    // The resident is a person making a real claim, not a model.
    expect(screen.getByText(/says it is fixed/)).not.toHaveTextContent(/prototype/)
  })

  it('offers the filer the moves that are theirs, and sends them as the reporter', async () => {
    const board = makeBoard({ complaints: [complaint({ isMine: true, status: 'filed' })] })
    renderView(board)
    fireEvent.click(screen.getByRole('button', { name: "It's fixed" }))

    expect(board.setStatus).toHaveBeenCalledWith('c-1', 'resolved', { kind: 'reporter' })

    // The card clears its busy flag when the board's promise settles. `async` on
    // the test is not enough on its own — with no `await` in the body it still ran
    // to completion synchronously, leaving that update outside act().
    await waitFor(() => expect(screen.getByRole('button', { name: "It's fixed" })).toBeEnabled())
  })

  it('offers a neighbour nothing to move, because it is not theirs to say', () => {
    renderView(makeBoard({ complaints: [complaint({ isMine: false, status: 'filed' })] }))
    expect(screen.queryByRole('button', { name: "It's fixed" })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "We've seen this" })).not.toBeInTheDocument()
  })

  it('does not offer a resident the municipal half of the table', () => {
    // `filed → acknowledged` belongs to a crew. A resident asserting it would be
    // a citizen writing a municipal response.
    renderView(makeBoard({ complaints: [complaint({ isMine: true, status: 'filed' })] }))
    expect(screen.queryByRole('button', { name: /We've seen this/ })).not.toBeInTheDocument()
  })

  it('offers the filer "still happening" only once the report reads resolved', () => {
    renderView(makeBoard({
      complaints: [complaint({ isMine: true, status: 'resolved', statusKind: 'crew', statusActor: 'crew-1' })],
    }))
    expect(screen.getByRole('button', { name: /Still happening/ })).toBeInTheDocument()
    // "It's fixed" is not offered against a report that already reads resolved.
    expect(screen.queryByRole('button', { name: "It's fixed" })).not.toBeInTheDocument()
  })

  it('keeps the wording the server will accept, so a button is never a 409 waiting to happen', () => {
    // The move is read straight off the same table the server enforces; this
    // pins the label to the transition it stands for.
    renderView(makeBoard({ complaints: [complaint({ isMine: true, status: 'acknowledged' })] }))
    expect(screen.getByRole('button', { name: "It's fixed" })).toBeInTheDocument()
  })
})
