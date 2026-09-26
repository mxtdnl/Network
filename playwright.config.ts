import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against `vite preview`, i.e. the production build served
// under the GitHub Pages base path with the Content Security Policy in force.
// PW_CHROMIUM_EXECUTABLE lets a machine with a preinstalled Chromium of another
// revision use it instead of downloading the one Playwright pins.
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/network/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/network/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
