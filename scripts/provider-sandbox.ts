import { pathToFileURL } from 'node:url';
import { readSandboxConfig, SandboxError } from '../tests/sandbox/config';
/** Offline only: validates explicit env and limits, never contacts a provider. */
export function sandboxPreflight(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): string {
  if (args.includes('--help')) return 'Manual-assisted sandbox acceptance. Read docs/provider-acceptance.md. Preflight makes no external requests. Run npm run test:sandbox only after configuring a disposable staging deployment and an existing dedicated test user.';
  if (args.length) throw new SandboxError('SANDBOX_UNKNOWN_PREFLIGHT_ARGUMENT');
  const config = readSandboxConfig(env);
  return `Offline preflight passed: ${config.provider}, ${config.planId}, ${config.scenario}, test mode only. No connection, checkout, webhook or D1 acceptance has been executed. Next: npm run test:sandbox. Authentication, actual deployed mode, D1 isolation, hosted test banner and ledger will be verified during that explicitly started run.`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(`${sandboxPreflight()}\n`); }
  catch (error) {
    process.stderr.write(`${error instanceof SandboxError ? error.code : 'SANDBOX_PREFLIGHT_FAILED'}\n`);
    process.exitCode = 1;
  }
}
