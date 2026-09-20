import { test, expect } from '@playwright/test'

/**
 * The phone header.
 *
 * Every other spec in this directory runs at `devices['Desktop Chrome']` —
 * 1280x720, above Tailwind's `lg` (1024px) breakpoint. So the responsive path in
 * `App.jsx`'s header had no automated coverage at all: the whole
 * `hidden lg:inline` / `basis-full lg:basis-auto` arrangement, and the
 * `--header-h` custom property the `ResizeObserver` publishes, were exercised by
 * nothing but a desktop browser that never takes those branches.
 *
 * The defect these tests exist to catch, measured at 390px before the fix:
 * `hdr=96 clearance=-28 taglines=3 nav over by 234px visible=1/4`. The tagline had
 * no `whitespace-nowrap`, so it folded to three lines and took the header to 96px;
 * the nav, having no row of its own, was pushed off the right-hand edge, leaving
 * three of the four views unreachable on a phone. In the same breath `main`
 * reserved a hardcoded `4.2rem` (67px) against a 96px header, so the top 29px of
 * content sat underneath the navbar.
 *
 * Most assertions below fail on that pre-fix markup, which is what keeps this from
 * being a suite that would have passed all along. Two of them do not, and are
 * premises the rest depend on rather than defect detectors: `toHaveLength(4)`
 * counts four buttons that the broken header also rendered (it clipped them, it
 * did not remove them), and `headerTop === 0` pins the navbar in place so the
 * viewport-relative rects below mean anything.
 */

test.use({ viewport: { width: 390, height: 844 } })

/**
 * Read the header, nav and content geometry as the browser actually laid it out.
 *
 * One content measurement, `rootTop`: the laid-out top of the view's root element,
 * `main > div > *` — a single `.editorial-container py-10` in all four views
 * (CitizenView:76, FieldOpsView:79, CityOverviewView:90, ComplaintsView:278). That is
 * the first pixel any view occupies, its own top padding included; measuring the first
 * *heading* instead would sit ~40px lower and quietly under-test by exactly the amount
 * a view pads its own top.
 *
 * This was previously a minimum-top scan over the wrapper's in-flow descendants, on the
 * theory that it avoided hardcoding a selector. That was the wrong box. Every in-flow
 * descendant sits inside the root's padding box, so the root always won the scan — and
 * the first view to add a negative-offset element at its top (`-mt-2`, an upward motion
 * flourish) would have become the minimum and made the assertion unsatisfiable on a
 * working layout. Reading the first child is the same number today, stated explicitly.
 */
const geometry = page =>
  page.evaluate(() => {
    const hd = document.querySelector('header')
    const main = document.querySelector('main')
    const nav = hd.querySelector('nav')
    const wrapper = main.querySelector(':scope > div')
    const root = wrapper ? wrapper.firstElementChild : null
    const rect = el => el.getBoundingClientRect()
    const span = text => [...hd.querySelectorAll('span')].find(s => s.textContent.trim() === text)
    const tagline = span('Watch over Lahore')
    const wordmark = span('Nigran')

    const name = el =>
      el ? `${el.tagName.toLowerCase()}.${(el.className || '').toString().trim().split(/\s+/)[0] || ''}` : null

    return {
      published: document.documentElement.style.getPropertyValue('--header-h').trim(),
      padTop: parseFloat(getComputedStyle(main).paddingTop),
      headerTop: rect(hd).top,
      headerBottom: rect(hd).bottom,
      headerHeight: rect(hd).height,
      taglineDisplay: tagline ? getComputedStyle(tagline).display : 'MISSING',
      wordmarkBottom: wordmark ? rect(wordmark).bottom : null,
      navTop: rect(nav).top,
      // Not observable through scrollWidth: at `lg` the nav is shrink-to-fit
      // (`lg:basis-auto`), so `scrollWidth === clientWidth` whether or not the
      // `overflow-x: visible` override is still in the stylesheet. Read the property.
      navOverflowX: getComputedStyle(nav).overflowX,
      rootTop: root ? rect(root).top : null,
      rootAt: root ? name(root) : 'NO VIEW ROOT',
      scrollY: window.scrollY,
      viewportWidth: window.innerWidth,
      pills: [...nav.querySelectorAll('button')].map(b => {
        const box = rect(b)
        // What a pointer at the pill's own centre would actually hit. This is what
        // makes the assertion mean "reachable" rather than "present in the DOM":
        // a pill can be laid out inside the viewport and still be covered.
        const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)
        const reachable = hit === b || b.contains(hit)
        return {
          label: b.textContent.trim(),
          left: box.left,
          right: box.right,
          inside: box.left >= -1 && box.right <= window.innerWidth + 1,
          reachable,
          coveredBy: reachable ? null : hit ? `${hit.tagName}.${hit.className}` : 'nothing',
        }
      }),
    }
  })

/**
 * framer-motion enters each view with a downward translate, so a measurement taken
 * mid-entry reads content lower than it settles — in the lenient direction, since
 * moving content away from the navbar makes the clearance look bigger than it is.
 *
 * Measured on a click at 390px: the transform is `matrix(1, 0, 0, 1, 0, 0.207)` by
 * the time a Playwright round trip can sample it, `0.009` at t+40ms, `none` by
 * t+100ms. The easing is an expo-out, so the translate barely exists by the time
 * anything can observe it. Polling is still the right guard — it is exact where a
 * fixed 400ms sleep is a guess — but note the threshold is half a pixel, not
 * identity: 0.207 already reads as settled.
 *
 * `main > div` is the animated wrapper and, while a view switches, AnimatePresence
 * can hold two rendered children at once. It does not here — the child declares no
 * `exit`, so a departing view is dropped rather than animated out — but if that
 * changes, the first `div` is no longer unambiguous and this would need a key.
 */
const settled = page =>
  expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector('main > div')
          if (!el) return 'no view'
          const t = getComputedStyle(el).transform
          if (t === 'none') return 'settled'
          // Parsed rather than string-matched: framer may emit either `matrix(…)`
          // or `matrix3d(…)`, and an equality check against one spelling would hang
          // on the other until the test timed out.
          const m = t.match(/^matrix(3d)?\(([^)]+)\)$/)
          if (!m) return t
          const n = m[2].split(',').map(Number)
          const tx = m[1] ? n[12] : n[4] // matrix → (e,f); matrix3d → (m41,m42)
          const ty = m[1] ? n[13] : n[5]
          return Math.abs(tx) < 0.5 && Math.abs(ty) < 0.5 ? 'settled' : t
        }),
      { message: 'the view never finished its entry transition' },
    )
    .toBe('settled')

const NAV = [
  { label: 'Citizen', anchor: /Your area/i },
  { label: 'Field Ops', anchor: /Field Ops — prototype dispatch queue/i },
  { label: 'City Overview', anchor: /City Overview — Lahore, today/i },
  { label: 'Complaints', anchor: /Complaints — what residents can see/i },
]

/**
 * Nothing the view draws sits under the navbar.
 *
 * One assertion, not two. The view root's top *is* `main`'s content-box top — the root
 * has no top margin and its `py-10` is padding inside its own box — so measuring
 * `main`'s reserved padding as well would be the same number reported twice. The
 * wiring, that `main` still reads the published token rather than its hardcoded
 * fallback, is checked separately in test 2 against the header's live height.
 *
 * The 1px allowance is required rather than slack. The token is `el.offsetHeight`, an
 * integer, while the header's true height is fractional — measured at 390px, 108
 * against 108.47. A correct layout is therefore legitimately up to a pixel under the
 * navbar, and without the allowance the suite would flake on that rounding. Note the
 * consequence: the blind spot is ≤1px, so an overlap of 1.5px is still caught.
 *
 * What this cannot catch, and should not be trusted for: a regression that puts the
 * tagline back. The published token is the header's *own* measured height, so growing
 * the header grows what `main` reserves in the same breath and the clearance stays
 * correct by construction — the 29px overlap the header docblock describes is no longer
 * reachable this way. The tagline's guard is the display assertion in test 1. What this
 * does catch is the other failure mode, `main` falling back to hardcoded `4.2rem`, which
 * is wrong at every width below `lg` and — that fallback being slightly *larger* than
 * the 66px one-line header — invisible at `lg` itself. That asymmetry is why test 2
 * checks the clearance at six widths under the breakpoint rather than only above it.
 */
const expectClearOfHeader = (g, where) => {
  expect(g.headerTop, `${where}: the navbar is not pinned to the top`).toBe(0)
  expect(g.scrollY, `${where}: the page is scrolled, so these viewport rects mislead`).toBe(0)
  expect(
    g.headerBottom - g.rootTop,
    `${where}: ${g.rootAt} starts ${(g.headerBottom - g.rootTop).toFixed(2)}px under the navbar`,
  ).toBeLessThanOrEqual(1)
}

test.describe('Nigran — phone header', () => {
  test('keeps the tagline out of the way, and every view reachable', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await expect(page.getByText(NAV[0].anchor)).toBeVisible({ timeout: 15_000 })
    await settled(page)

    // The tagline is the decorative half of the wordmark, and below `lg` it is what
    // forces the nav onto a second row and the header to 96px. Hiding it is the
    // fix; this is the assertion that fails the moment it comes back.
    const g = await geometry(page)
    expect(g.taglineDisplay).toBe('none')

    // The nav has a row of its own — it wrapped below the wordmark rather than
    // being squeezed onto the wordmark's line. Without `basis-full` it stays up
    // there and runs off the right-hand edge.
    expect(g.navTop).toBeGreaterThanOrEqual(g.wordmarkBottom)

    // At 390px every pill's box is inside the viewport — measured against
    // `innerWidth`, so this says the boxes are on screen, not that the row has no
    // overflow. The four labels come close to the width of the pill area at this
    // size; the row's `overflow-x` is what keeps that from mattering.
    expect(g.pills).toHaveLength(4)
    const out = g.pills.filter(p => !p.inside).map(p => `${p.label} [${p.left.toFixed(0)}..${p.right.toFixed(0)}]`)
    expect(out, `nav pills past the viewport edge at 390px: ${out.join(', ')}`).toEqual([])
    const covered = g.pills.filter(p => !p.reachable).map(p => `${p.label} under ${p.coveredBy}`)
    expect(covered, `nav pills not receiving pointer events: ${covered.join(', ')}`).toEqual([])

    // Fire events that update state, and assert on the output: clicking each pill
    // in turn renders that view. Reaching a view by click is the end-to-end claim
    // the layout above only supports geometrically.
    for (const { label, anchor } of NAV) {
      await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).click()
      await expect(page.getByText(anchor)).toBeVisible({ timeout: 15_000 })
      await settled(page)

      // Each view opens on different content, so the clearance is checked on all
      // four rather than assumed from the first. The active pill's mint fill also
      // swaps on every click, which is a second state change to land.
      expectClearOfHeader(await geometry(page), label)
    }
  })

  test('reserves the header’s real height, at every width below lg', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await expect(page.getByText(NAV[0].anchor)).toBeVisible({ timeout: 15_000 })

    // 320 is the narrowest phone in the target range and the floor the nav's
    // `overflow-x` exists for; 768 and 900 are tablet, still below `lg`.
    for (const width of [320, 360, 390, 430, 768, 900]) {
      await page.setViewportSize({ width, height: 844 })

      // Wait for the ResizeObserver to republish, not merely for the token to exist.
      // `publish()` runs synchronously on mount (and before `observer.observe`), so
      // the token is non-empty from the first frame: a "not empty" poll would be
      // satisfied instantly by the previous width's value and wait for nothing.
      // Comparing the token against the header's live height is what actually waits.
      await expect
        .poll(
          async () => {
            const g = await geometry(page)
            return Math.abs(parseFloat(g.published || 'NaN') - g.headerHeight)
          },
          { message: `--header-h was never republished for a ${width}px header` },
        )
        .toBeLessThanOrEqual(1)

      await settled(page)
      const g = await geometry(page)
      const published = parseFloat(g.published)

      // `main` reserves exactly the height the observer published — true by
      // construction while the wiring is intact, which is the point: it fails the
      // moment `main` stops reading the token and falls back to the hardcoded
      // `4.2rem`, which differs from the real header at every width here.
      expect(
        g.padTop - published,
        `main's padding (${g.padTop}) does not match the published ${published}px at ${width}px`,
      ).toBeCloseTo(0, 1)

      // Below `lg` the row is a horizontal scroll container, which is what the
      // narrow-width floor depends on.
      expect(
        g.navOverflowX,
        `at ${width}px the nav row is not a scroll container (overflow-x: ${g.navOverflowX})`,
      ).toBe('auto')

      // And the consequence a person can see.
      expectClearOfHeader(g, `at ${width}px`)

      // Reachable at this width means "can be brought fully into view", which is
      // not the same as "simultaneously visible". By 320px the four labels are
      // wider than the content band, and that is exactly what the row's
      // `overflow-x` is for — so the pill is scrolled into view first, and only
      // then measured. Asserting simultaneous visibility here would fail on a
      // layout that is working as designed.
      for (let i = 0; i < g.pills.length; i++) {
        const pill = page.getByRole('button', { name: new RegExp(`^${NAV[i].label}$`, 'i') })
        await pill.evaluate(el => el.scrollIntoView({ inline: 'nearest', block: 'nearest' }))
        const after = (await geometry(page)).pills[i]
        expect(
          after.inside,
          `at ${width}px ${NAV[i].label} cannot be scrolled into view: [${after.left.toFixed(0)}..${after.right.toFixed(0)}]`,
        ).toBe(true)
        expect(after.reachable, `at ${width}px ${NAV[i].label} is covered by ${after.coveredBy}`).toBe(true)
      }
    }
  })

  test('restores the tagline and the full-width nav at lg', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(NAV[0].anchor)).toBeVisible({ timeout: 15_000 })

    // The other side of the breakpoint. Without this, hiding the tagline at every
    // width would pass the two tests above while quietly deleting the brand line
    // from the desktop layout the judges actually see.
    //
    // The one-row assertion below is the only thing in this file guarding
    // `lg:basis-auto`. Drop that class and the nav keeps the row `basis-full` gives
    // it at every width — measured by forcing `flex-basis: 100%` at 1024px, `navTop`
    // moves from 14.59 to 59.39 (the 8px of `gap-y-2` below the wordmark's own
    // bottom edge at 51.39) and the header from 65.98 to 109.77, while the pill
    // boxes, the overflow property and the clearance all stay green and notice
    // nothing.
    //
    // A failure here reads 59.39, and that number does not say why: both known
    // causes put the nav on a second row. One is `lg:basis-auto` going missing.
    // The other is text metrics — first written up here as a stale `dist` served
    // through the config's `reuseExistingServer`, which was wrong: it reproduces
    // on a fresh build. The row has ~15px of slack at 1024px while the feeds are
    // still loading, and Google Fonts arrives with `display=swap`, which the
    // `load` event does not wait for. Measured early, the wordmark is still
    // Georgia and 35.6px wider, the children want 906.55px of an 896px box, and
    // `flex-wrap` drops the nav a row. `lg:flex-nowrap` on the header row removes
    // that cause, so this assertion now guards the class alone.
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(async () => (await geometry(page)).taglineDisplay).not.toBe('none')
      await settled(page)

      const g = await geometry(page)
      expect(
        g.navTop,
        `at ${width}px the nav is on its own row (top ${g.navTop} vs wordmark bottom ${g.wordmarkBottom}) — is lg:basis-auto still applied?`,
      ).toBeLessThan(g.wordmarkBottom)
      // No longer a scroll container, every pill on screen, and the content still
      // clear of the navbar — the tagline coming back must not re-break any of it.
      expect(
        g.navOverflowX,
        `at ${width}px the nav row still scrolls (overflow-x: ${g.navOverflowX})`,
      ).toBe('visible')
      expect(
        g.pills.filter(p => !p.inside).map(p => p.label),
        `at ${width}px these nav pills are off-screen`,
      ).toEqual([])
      expectClearOfHeader(g, `at ${width}px`)
    }
  })
})
