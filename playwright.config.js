import { defineConfig } from '@playwright/test';
const browserName = process.env.TEST_BROWSER || 'chromium';
const production = process.env.TEST_PRODUCTION === '1';
const port = Number(process.env.TEST_PORT || (production ? 4173 : 5173));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid TEST_PORT');
const url = 'http://127.0.0.1:' + port;
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  timeout: browserName === 'webkit' ? 60000 : 30000,
  expect: { timeout: browserName === 'webkit' ? 30000 : 10000 },
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  outputDir: 'test-results/' + browserName,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report/' + browserName }],
  ],
  grepInvert: browserName === 'chromium' ? undefined : /@chromium/,
  use: {
    browserName,
    baseURL: url,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath:
        browserName === 'chromium' ? process.env.CHROMIUM_PATH || undefined : undefined,
    },
  },
  webServer: {
    command: production
      ? 'npm run preview -- --port ' + port + ' --strictPort'
      : 'npm run dev -- --port ' + port + ' --strictPort',
    url,
    reuseExistingServer: !process.env.CI,
  },
});
