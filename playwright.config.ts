import {mkdtempSync} from 'node:fs';
process.env.E2E_PERSIST_PATH ||= mkdtempSync('/tmp/edgekit-e2e-');
import {defineConfig,devices} from '@playwright/test';
// All files share one local D1 fixture. Serialize files as well as tests to avoid
// profile edits, session revocation, and limiter state racing across workers.
export default defineConfig({testDir:'tests/e2e',globalSetup:'./tests/e2e/setup.ts',fullyParallel:false,workers:1,retries:0,use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}},projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],webServer:{command:'node --import tsx tests/e2e/start-worker.ts',url:'http://127.0.0.1:4173/api/health',reuseExistingServer:false,timeout:120000,env:{E2E_PERSIST_PATH:process.env.E2E_PERSIST_PATH,WRANGLER_LOG_PATH:'/tmp/saas-wrangler.log',CLOUDFLARE_SEND_METRICS:'false'}}});
