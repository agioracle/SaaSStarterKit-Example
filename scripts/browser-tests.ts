import { installLuminaFixtures } from "./local/lumina-fixtures";
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { prepareLocalSmoke, localSmokeEnvironment } from './local/isolation';
import { seedBrowserContent } from './local/content-fixtures';

const [scope = '--all', ...extra] = process.argv.slice(2);
if (!['--all', '--http', '--browser', '--captured', '--lumina'].includes(scope)) throw Error('Use --all, --http, --browser or --captured.');
const source = process.cwd();
function run(cwd: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit', shell: false, timeout: 600_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`Local browser fixture command failed (${result.status}).`);
}
function environment(target: string) {
  const env = localSmokeEnvironment(target);
  // Preserve the browser installation location while keeping the fixture HOME
  // isolated from operator credentials. Playwright otherwise searches .home.
  const cache = process.platform === 'darwin' ? resolve(homedir(), 'Library/Caches')
    : process.platform === 'win32' ? process.env.LOCALAPPDATA || resolve(homedir(), 'AppData/Local')
      : process.env.XDG_CACHE_HOME || resolve(homedir(), '.cache');
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  env.PLAYWRIGHT_BROWSERS_PATH = browsers === '0' ? '0' : resolve(source, browsers || resolve(cache, 'ms-playwright'));
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const axe = process.env.EDGEKIT_QA_AXE_PATH || resolve(source, 'node_modules/axe-core/axe.min.js');
  if (existsSync(axe)) env.EDGEKIT_QA_AXE_PATH = axe;
  if (process.env.EDGEKIT_QA_EVIDENCE) env.EDGEKIT_QA_EVIDENCE = resolve(source, process.env.EDGEKIT_QA_EVIDENCE);
  return env;
}
if (scope !== '--captured') {
  const target = prepareLocalSmoke(source);
  seedBrowserContent(source, target);
  if (scope === "--lumina") installLuminaFixtures(target);
  console.log(`Isolated browser checkout (test-only Markdown): ${target}`);
  const env = environment(target);
  run(target, [resolve(target, 'node_modules/vite/bin/vite.js'), 'build'], env);
  for (const tag of scope === '--all' ? ['@http', '@browser'] : [scope === '--http' ? '@http' : scope === '--lumina' ? '@lumina' : '@browser']) {
    // Each suite gets fresh local D1 and sessions; no weakening of production rate limits.
    run(target, [resolve(target, 'node_modules/@playwright/test/cli.js'), 'test', '--grep', tag, ...extra], env);
  }
}
if (scope === '--all' || scope === '--captured') {
  mkdirSync(resolve(source, '.home'), { recursive: true });
  run(source, ['--import', 'tsx', resolve(source, 'tests/manual/prepare-browser-fixture.ts')], environment(source));
  const { target } = JSON.parse(readFileSync(resolve(source, 'browser-fixture.json'), 'utf8')) as { target: string };
  run(target, [resolve(target, 'node_modules/@playwright/test/cli.js'), 'test', 'tests/e2e/captured-mail.spec.ts', '--trace=off', ...extra], { ...environment(target), EDGEKIT_CAPTURED_MAIL_FIXTURE: '1' });
}
