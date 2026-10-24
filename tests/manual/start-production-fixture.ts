import { mkdtempSync } from 'node:fs';
process.env.E2E_PERSIST_PATH ||= mkdtempSync('/tmp/edgekit-e2e-');
// The same isolated local D1 and fixed synthetic users as test:browser. Keeps
// the Worker alive for authorized manual browser / Lighthouse checks.
const { default: setup } = await import('../e2e/setup');
await setup();
await import('../e2e/start-worker');
