import { defineConfig, devices } from '@playwright/test';
import { isolatedE2EEnvironment } from './e2e/environment';

isolatedE2EEnvironment();

const webUrl = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3000';
const apiUrl = process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI
    ? [['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'pnpm --filter @digital-autograph/worker dev',
      wait: { stdout: /Worker ready \(test\); polling private autograph jobs/ },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @digital-autograph/api dev',
      url: `${apiUrl}/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @digital-autograph/web dev',
      url: webUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
