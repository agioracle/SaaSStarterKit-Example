import { defineConfig, devices } from '@playwright/test';
import { readSandboxConfig } from './tests/sandbox/config';
const sandbox = readSandboxConfig();
// Playwright 1.64 otherwise captures an automatic ARIA snapshot on failure.
// Hosted payment pages can include personal data, even with trace/video off.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: './tests/sandbox', testMatch: `${sandbox.provider}.spec.ts`,
  globalSetup: './tests/sandbox/global-setup.ts',
  fullyParallel: false, workers: 1, retries: 0, repeatEach: 1, forbidOnly: true,
  timeout: sandbox.manualTimeoutMs + sandbox.webhookTimeoutMs + sandbox.lifecycleTimeoutMs + sandbox.declineObservationMs + 120_000,
  globalTimeout: sandbox.manualTimeoutMs + sandbox.webhookTimeoutMs + sandbox.lifecycleTimeoutMs + sandbox.declineObservationMs + 150_000,
  reporter: [['./tests/sandbox/reporter.ts']], outputDir: 'test-results/sandbox',
  use: {
    ...devices['Desktop Chrome'], baseURL: sandbox.origin, headless: false,
    trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block',
    actionTimeout: 15_000, navigationTimeout: 30_000,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  projects: [{ name: sandbox.provider }],
  // No webServer, deploy, tunnel, migration, fixture signup, or secret upload.
});
