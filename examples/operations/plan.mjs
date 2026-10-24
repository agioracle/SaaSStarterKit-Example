#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
/** Deliberately has NO execution mode. Returning strings cannot export, deploy, or restore anything. */
export function upgradePlan({ database, worker, backup = '/PRIVATE_BACKUP_DIRECTORY/pre-upgrade.sql' }) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(database || '') || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(worker || ''))
    throw Error('Use explicit database and Worker names (lowercase letters, digits, hyphens).');
  if (!backup.startsWith('/') || !backup.endsWith('.sql') || /[\r\n]/.test(backup)) throw Error('Backup must be an absolute SQL file path.');
  return [
    { kind: 'local-check', argv: ['npm', 'run', 'check'] },
    { kind: 'isolated-local-http', argv: ['npm', 'run', 'smoke:local'] },
    { kind: 'remote-read-bookmark', argv: ['npx', '--no-install', 'wrangler', 'd1', 'time-travel', 'info', database] },
    { kind: 'remote-export-to-sensitive-file', argv: ['npx', '--no-install', 'wrangler', 'd1', 'export', database, '--remote', '--output', backup] },
    { kind: 'migration-plan-only', argv: ['npm', 'run', 'setup', '--', 'migrate', '--remote'] },
    { kind: 'deploy-plan-only', argv: ['npm', 'run', 'setup', '--', 'deploy'] },
    { kind: 'reviewed-worker-only-rollback', argv: ['npx', '--no-install', 'wrangler', 'rollback', 'EXACT_REVIEWED_VERSION_ID', '--name', worker] },
    { kind: 'DESTRUCTIVE-REMOTE-DATABASE-RESTORE-NOT-AUTO', argv: ['npx', '--no-install', 'wrangler', 'd1', 'time-travel', 'restore', database, '--bookmark', 'EXACT_REVIEWED_BOOKMARK'] },
  ];
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { database: { type: 'string' }, worker: { type: 'string' }, backup: { type: 'string' } } });
    const plan = upgradePlan(values);
    console.log('DRY RUN ONLY. No files, subprocesses, credentials, or network are accessed. No --execute mode exists.');
    for (const step of plan) console.log(`${step.kind}: ${JSON.stringify(step.argv)}`);
    console.log('Review each operation separately. Worker rollback does not restore D1/R2/KV/secrets. Database restore discards later writes and requires a separate incident decision.');
  } catch (error) { console.error(error instanceof Error ? error.message : 'Invalid plan'); process.exitCode = 1; }
}
