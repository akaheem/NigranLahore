import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  // SwiftShader page loads + nav clicks can consume most of a 30s budget on a
  // loaded machine; 90s keeps the suite deterministic without masking hangs.
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    // The design system uses long luxury transitions + continuous ambient
    // animation; Playwright's stability heuristic can otherwise time out on
    // clicks. actionTimeout: force-clicks in tests are avoided, this keeps
    // the auto-waiting within reason.
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Headless GPU processes die after sustained dual-WebGL rendering
          // (Galaxy + LiquidEther), killing pages mid-test with
          // 'session closed'. SwiftShader keeps the suite deterministic;
          // the guards in Galaxy.jsx skip the starfield when WebGL is
          // unavailable, degrading decoration while core features stay live.
          args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // Never reuse. With reuse on, a preview server left running from an earlier
    // session still answers this URL and the suite tests whatever `dist` that
    // process is holding — the build in this command is then skipped, silently.
    // It has cost two runs already: one phantom layout measurement and one
    // failure, both reading navTop 59.39 at 1024px, which is what a bundle
    // without `lg:basis-auto` looks like and not what the source produces.
    // `npm run build` costs about 2s; a green suite against a bundle nobody is
    // shipping costs the entire point of running it. Failing loudly on a busy
    // port is the correct behaviour here.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
