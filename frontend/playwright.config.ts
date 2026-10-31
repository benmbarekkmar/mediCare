import { defineConfig, devices } from '@playwright/test';

/** Start the API, NLP service and Fuseki separately with an isolated test dataset. */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4300';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  projects: [
    {
      name: 'desktop-e2e',
      testMatch: 'medicare.spec.ts',
      use: { baseURL, ...devices['Desktop Chrome'], channel: 'chrome', headless: true },
    },
    {
      name: 'mobile-375',
      testMatch: 'responsive.spec.ts',
      use: { baseURL, ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, channel: 'chrome', headless: true },
    },
  ],
});