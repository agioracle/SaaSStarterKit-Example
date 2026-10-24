import type { FullConfig } from '@playwright/test';
import { readSandboxConfig, requireSandbox } from './config';
export default function setup(config: FullConfig): void {
  const sandbox = readSandboxConfig();
  requireSandbox(process.env.PLAYWRIGHT_NO_COPY_PROMPT === '1', 'SANDBOX_PAGE_SNAPSHOT_FORBIDDEN');
  requireSandbox(config.workers === 1 && !config.shard, 'SANDBOX_PARALLEL_EXECUTION_FORBIDDEN');
  requireSandbox(config.projects.length === 1 && config.projects[0].name === sandbox.provider, 'SANDBOX_SINGLE_PROVIDER_REQUIRED');
  for (const project of config.projects) {
    requireSandbox(project.retries === 0 && project.repeatEach === 1, 'SANDBOX_RETRY_OR_REPEAT_FORBIDDEN');
    requireSandbox(project.use.headless === false, 'SANDBOX_MANUAL_BROWSER_REQUIRED');
    requireSandbox(project.use.trace === 'off' && project.use.screenshot === 'off' && project.use.video === 'off', 'SANDBOX_SENSITIVE_RECORDING_FORBIDDEN');
  }
  requireSandbox(config.reporter.length === 1 && config.reporter[0][0].endsWith('tests/sandbox/reporter.ts'), 'SANDBOX_REDACTED_REPORTER_REQUIRED');
}
