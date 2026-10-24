import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { localSmokeEnvironment, prepareLocalSmoke } from '../../scripts/local/isolation';

// Reuse smoke:local isolation and its real auth/provider seam. The only test
// double is mail delivery, just like auth.integration.test.ts. Never alter the
// released worker, bypass verification, or create real provider credentials.
const target = prepareLocalSmoke(process.cwd());
const provider = `import { providerRegistry } from './mail/index.server';
import type { Bindings } from './env';
import type { RawEmail, MailProvider } from './mail/types';
for (const name of ['cloudflare', 'resend'] as const) {
  providerRegistry[name] = ({ env }): MailProvider => ({
    getProviderName: () => name,
    async sendRawEmail(message: RawEmail) {
      if (env.APP_ENV !== 'test' || !message.to.endsWith('@example.invalid'))
        throw Error('Local capture accepts test fixtures only');
      await (env.CACHE as KVNamespace).put('browser-fixture-mail:' + message.to,
        JSON.stringify(message), { expirationTtl: 600 });
      return { id: 'browser-fixture-capture', provider: name, accepted: true };
    },
    async sendTemplate() { throw Error('Use the real shared renderer before capture'); },
  });
}
export async function capturedMail(request: Request, env: Bindings) {
  const url = new URL(request.url);
  if (url.pathname !== '/__local_fixture/mail') return null;
  const to = url.searchParams.get('to') || '';
  if (env.APP_ENV !== 'test' || url.hostname !== '127.0.0.1' || !to.endsWith('@example.invalid'))
    return new Response('Not found', { status: 404 });
  const mail = await env.CACHE.get('browser-fixture-mail:' + to);
  return new Response(mail || '{}', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
`;
writeFileSync(join(target, 'src/browser-capture-fixture.server.ts'), provider);
const worker = join(target, 'src/worker.ts');
const original = readFileSync(worker, 'utf8');
if (!original.includes('fetch(request: Request) {')) throw Error('Review worker entry before using this fixture.');
const capturedWorker = original.replace('fetch(request: Request) {', 'async fetch(request: Request, env: Bindings) {\n    const captured = await capturedMail(request, env);\n    if (captured) return captured;');
writeFileSync(worker, `import { capturedMail } from './browser-capture-fixture.server';\n${capturedWorker}`);
writeFileSync(join(target, 'BROWSER-FIXTURE-ONLY.txt'), 'LOCAL TEST ONLY. Captures authentication mail in local KV. Never deploy or package this directory. Production source is untouched.\n');
writeFileSync('browser-fixture.json', JSON.stringify({ target, origin: 'http://127.0.0.1:4173' }, null, 2));
const built = spawnSync(process.execPath, [join(target, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: target, env: localSmokeEnvironment(target), stdio: 'inherit', shell: false,
});
if (built.status !== 0) throw Error('Fixture build failed.');
console.log(`Captured-mail browser fixture ready: ${target}`);
