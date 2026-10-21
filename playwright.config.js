import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'phone-320',
      use: {
        ...devices['Desktop Chrome'],
        viewport: {
          width: 320,
          height: 568,
        },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'chromium-offline',
      use: {
        ...devices['Desktop Chrome'],
        offline: true,
        serviceWorkers: 'block',
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120000,
  },
});