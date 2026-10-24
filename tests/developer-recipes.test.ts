import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { upgradePlan } from '../examples/operations/plan.mjs';
import { applyPrivateNotes } from '../examples/private-notes/apply.mjs';
import { createExtensionSession } from '../examples/extension-client/session';
import { noteMessages } from '../examples/private-notes/files/src/features/private-notes/messages';

function project() {
  // macOS exposes its system temp directory through /var -> /private/var.
  // Supply the real fixture path while keeping the installer's symlink refusal.
  const path = realpathSync(mkdtempSync(resolve(tmpdir(), 'edgekit-recipe-')));
  mkdirSync(resolve(path, 'src/db'), { recursive: true });
  writeFileSync(resolve(path, 'src/db/schema.ts'), "export * from './auth.schema';\n");
  writeFileSync(resolve(path, 'package.json'), '{}');
  return path;
}
describe('private notes installer contract', () => {
  it('defaults to a no-write plan listing a complete vertical slice', () => {
    const target = project();
    try {
      const log = vi.fn();
      const files = applyPrivateNotes({ target, log });
      expect(files).toEqual(expect.arrayContaining(['src/db/private-notes.schema.ts', 'src/routes/_app.settings.notes.tsx', 'src/routes/api.private-notes.ts', 'src/features/private-notes/service.server.ts', 'src/features/private-notes/runtime.server.ts', 'src/features/private-notes/page.tsx']));
      expect(existsSync(resolve(target, 'src/features'))).toBe(false);
      expect(readFileSync(resolve(target, 'src/db/schema.ts'), 'utf8')).not.toContain('private-notes');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Dry run only'));
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
  it('requires exact target confirmation and refuses collisions before any file is written', () => {
    const target = project();
    try {
      expect(() => applyPrivateNotes({ target, execute: true, confirm: 'yes', log: () => {} })).toThrow('exact absolute');
      writeFileSync(resolve(target, 'src/db/private-notes.schema.ts'), 'keep');
      expect(() => applyPrivateNotes({ target, execute: true, confirm: target, log: () => {} })).toThrow('overwrite');
      expect(existsSync(resolve(target, 'src/features'))).toBe(false);
      expect(readFileSync(resolve(target, 'src/db/private-notes.schema.ts'), 'utf8')).toBe('keep');
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
  it('installs files and schema export once, without migrations or provider configuration', () => {
    const target = project();
    try {
      const files = applyPrivateNotes({ target, execute: true, confirm: target, log: () => {} });
      for (const file of files) expect(existsSync(resolve(target, file))).toBe(true);
      expect(readFileSync(resolve(target, 'src/db/schema.ts'), 'utf8')).toContain("export * from './private-notes.schema';");
      expect(existsSync(resolve(target, 'drizzle'))).toBe(false);
      expect(existsSync(resolve(target, '.dev.vars'))).toBe(false);
      expect(existsSync(resolve(target, '.private-notes-install.lock'))).toBe(false);
      expect(() => applyPrivateNotes({ target, log: () => {} })).toThrow('already installed');
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
  it('refuses target directory symlinks', () => {
    const target = project();
    const link = `${target}-alias`;
    try { symlinkSync(target, link); expect(() => applyPrivateNotes({ target: link, log: () => {} })).toThrow('Symlink'); }
    finally { rmSync(link, { force: true }); rmSync(target, { recursive: true, force: true }); }
  });
  it('ships matching English and Chinese keys and a sensitive noindex route', () => {
    expect(Object.keys(noteMessages.en).sort()).toEqual(Object.keys(noteMessages.zh).sort());
    const route = readFileSync('examples/private-notes/files/src/routes/_app.settings.notes.tsx', 'utf8');
    expect(route).toContain('/_app/settings/notes');
    expect(route).toContain('noIndex: true');
  });
});

describe('extension client secure bridge', () => {
  const origin = 'https://app.example.test';
  const user = { id: 'extension-user', email: 'extension@example.test' };
  function transport() {
    return vi.fn<typeof fetch>(async (url) => String(url).endsWith('/api/extension/auth/google')
      ? Response.json({ user }, { headers: { 'set-auth-token': 'fixture-signed-session' } })
      : Response.json({ user }));
  }
  it.each(['http://example.test', 'https://app.example.test/path', 'https://user:pass@app.example.test', 'https://app.example.test/'])('rejects unsafe/non-exact origin %s', (origin) => {
    expect(() => createExtensionSession(origin)).toThrow();
  });
  it('exchanges Google token only at the dedicated endpoint, then uses signed bearer without cookies', async () => {
    const fetcher = transport();
    const session = createExtensionSession(origin, fetcher);
    expect(await session.signIn('fixture-google-access')).toEqual(user);
    expect(fetcher.mock.calls[0][0]).toBe(`${origin}/api/extension/auth/google`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', method: 'POST', body: JSON.stringify({ accessToken: 'fixture-google-access' }) });
    expect(fetcher.mock.calls[1][0]).toBe(`${origin}/api/me`);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: 'omit', headers: { Authorization: 'Bearer fixture-signed-session' } });
    expect(session.hasSession()).toBe(true);
    await session.signOut();
    expect(session.hasSession()).toBe(false);
    expect(fetcher.mock.calls[2][0]).toBe(`${origin}/api/auth/sign-out`);
  });
  it('does not accept an unsigned token returned in the response body', async () => {
    const session = createExtensionSession(origin, vi.fn(async () => Response.json({ token: 'raw-token', user })));
    await expect(session.signIn('fixture-google-access')).rejects.toThrow('signed session');
    expect(session.hasSession()).toBe(false);
  });
  it('clears rejected sessions and cannot make authenticated calls after local logout', async () => {
    const fetcher = transport();
    const session = createExtensionSession(origin, fetcher);
    await session.signIn('fixture-google-access');
    fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(session.getMe()).rejects.toThrow('(401)');
    expect(session.hasSession()).toBe(false);
    await expect(session.getMe()).rejects.toThrow('Sign in first');
  });
  it('clearLocalSession prevents an in-flight sign-in from reintroducing a token', async () => {
    let resolveResponse: (response: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    const session = createExtensionSession(origin, fetcher);
    const pending = session.signIn('fixture-google-access');
    session.clearLocalSession();
    resolveResponse(Response.json({ user }, { headers: { 'set-auth-token': 'fixture-signed-session' } }));
    await expect(pending).rejects.toThrow('superseded');
    expect(session.hasSession()).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reports failed remote revocation honestly while clearing local state', async () => {
    const fetcher = transport();
    const session = createExtensionSession(origin, fetcher);
    await session.signIn('fixture-google-access');
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(session.signOut()).rejects.toThrow('server revocation failed');
    expect(session.hasSession()).toBe(false);
  });
});


describe('upgrade operations planner', () => {
  it('only returns explicit target argv and separates Worker rollback from destructive restore', () => {
    const plan = upgradePlan({ database: 'reviewed-db', worker: 'reviewed-worker' });
    expect(plan.find((step) => step.kind === 'remote-export-to-sensitive-file')?.argv).toEqual(['npx', '--no-install', 'wrangler', 'd1', 'export', 'reviewed-db', '--remote', '--output', '/PRIVATE_BACKUP_DIRECTORY/pre-upgrade.sql']);
    expect(plan.find((step) => step.kind === 'reviewed-worker-only-rollback')?.argv).toContain('EXACT_REVIEWED_VERSION_ID');
    expect(plan.find((step) => step.kind.startsWith('DESTRUCTIVE'))?.argv).toContain('EXACT_REVIEWED_BOOKMARK');
    expect(JSON.stringify(plan)).not.toContain('--execute');
    expect(JSON.stringify(plan)).not.toContain('--yes');
  });
  it('rejects ambiguous target names or multiline backup paths', () => {
    expect(() => upgradePlan({ database: '', worker: 'app' })).toThrow();
    expect(() => upgradePlan({ database: 'db --remote', worker: 'app' })).toThrow();
    expect(() => upgradePlan({ database: 'db', worker: 'app', backup: '/tmp/one\ntwo.sql' })).toThrow();
  });
});
