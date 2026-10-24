import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createAuth, requireUser } from '../src/auth/index.server';
import { createD1PaymentStore } from '../src/db/payment-store';
import { createPaymentService } from '../src/payment/service';
import { createStripeProvider } from '../src/payment/providers/stripe';
import { hasPaymentAccess } from '../src/payment/entitlements';
import type { Bindings } from '../src/env';
import type { PaymentStore, PaymentUser } from '../src/payment/types';
import type { NotesDependencies } from '../examples/private-notes/files/src/features/private-notes/service.server';
import { handleNotes } from '../examples/private-notes/files/src/features/private-notes/service.server';
vi.mock('@tanstack/react-start/server-only', () => ({}));

/** Real local D1 + Better Auth signed sessions + ledger projection. No live provider requests. */
describe('private notes secure vertical slice', () => {
  let mf: Miniflare;
  let db: D1Database;
  let env: Bindings;
  let dependencies: NotesDependencies;
  let store: PaymentStore;
  let alice: PaymentUser;
  let bob: PaymentUser;
  let aliceToken: string;
  let bobToken: string;
  let network: ReturnType<typeof vi.fn>;
  const origin = 'http://localhost:3000';
  const now = Date.now();
  const namespace = { mode: 'test' as const, account: 'fixture-not-a-real-payment-account', deployment: origin };
  beforeAll(async () => {
    mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("recipe-test"); } };', compatibilityDate: '2026-10-01', d1Databases: ['DB'] }));
    db = await mf.getD1Database('DB') as unknown as D1Database;
    for (const name of readdirSync('drizzle').filter((name) => name.endsWith('.sql')).sort())
      for (const sql of readFileSync(`drizzle/${name}`, 'utf8').split('--> statement-breakpoint').map((sql) => sql.trim()).filter(Boolean)) await db.prepare(sql).run();
    const installed = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='private_notes'").first();
    if (!installed) for (const sql of readFileSync('examples/private-notes/schema.sql', 'utf8').split(';').map((sql) => sql.trim()).filter(Boolean)) await db.prepare(sql).run();
    env = { DB: db, BUCKET: {} as R2Bucket, CACHE: {} as KVNamespace, APP_ENV: 'test', APP_URL: origin, BETTER_AUTH_SECRET: 'recipe-test-only-fixture-76543102457891209876', GOOGLE_CLIENT_ID: 'fixture-web-client', GOOGLE_CLIENT_SECRET: 'fixture-web-secret', GOOGLE_EXTENSION_CLIENT_ID: 'fixture-extension-client' } as Bindings;
    async function member(email: string) {
      const auth = createAuth(env, { sub: `fixture-${email}`, email, email_verified: true, name: 'Recipe test user' });
      const response = await auth.api.signInSocial({ body: { provider: 'google', idToken: { token: 'verified-extension-profile' }, requestSignUp: true }, asResponse: true });
      expect(response.status).toBe(200);
      const token = response.headers.get('set-auth-token');
      expect(token).toBeTruthy();
      const result = await response.json() as { user: PaymentUser };
      return { user: result.user, token: token as string };
    }
    const a = await member('alice-recipe@example.test'); const b = await member('bob-recipe@example.test');
    alice = a.user; aliceToken = a.token; bob = b.user; bobToken = b.token;
    store = createD1PaymentStore(db);
    const payments = createPaymentService({ provider: createStripeProvider({ secretKey: 'sk_test_local_fixture', webhookSecret: 'whsec_fixture', mode: 'test' }), plans: [], store, appOrigin: origin, now: () => now, namespace });
    dependencies = {
      db, origin, now: () => now,
      authenticate: async (request) => (await requireUser(request, env)).user,
      hasPaidAccess: async (user) => { const value = await payments.getEntitlement(user); return !!value && value.paid && hasPaymentAccess(value, now); },
    };
  }, 30_000);
  beforeEach(async () => {
    await db.prepare('DELETE FROM private_notes').run();
    await db.prepare('DELETE FROM payment_checkouts').run();
    await db.prepare('DELETE FROM payment_namespaces').run();
    await db.prepare('UPDATE user SET banned=0').run();
    network = vi.fn(() => { throw Error('External requests forbidden in recipe tests'); });
    vi.stubGlobal('fetch', network);
  });
  afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  afterAll(async () => { if (mf) await mf.dispose(); }, 30_000);
  const request = (method = 'GET', body?: unknown, token = aliceToken, id?: string, requestOrigin = origin) => new Request(`${origin}/api/private-notes${id ? `?id=${id}` : ''}`, {
    method, headers: { origin: requestOrigin, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function create(token = aliceToken) {
    const response = await handleNotes(request('POST', { title: 'Hello', body: 'Private body' }, token), dependencies);
    expect(response.status).toBe(201);
    return (await response.json() as { note: { id: string } }).note.id;
  }
  async function pay(user: PaymentUser = alice, end = now + 60_000, paid = true) {
    await store.assertNamespace?.('stripe', namespace.mode, namespace.account, namespace.deployment);
    await store.createCheckout({ reference: `checkout-${user.id}`, userId: user.id, provider: 'stripe', createdAt: now, plan: { id: 'pro-monthly', priceId: 'price_fixture', kind: 'subscription', amount: 990, currency: 'USD' } });
    await store.appendEvent({ provider: 'stripe', id: `event-${user.id}`, checkoutReference: `checkout-${user.id}`, type: paid ? 'invoice.paid' : 'subscription.trial', effect: paid ? 'grant' : 'sync', state: paid ? 'active' : 'trialing', occurredAt: now, periodStart: now - 1000, periodEnd: end, lookup: { checkoutReference: `checkout-${user.id}`, subscriptionId: `sub-${user.id}` } });
  }
  it('matches the authored schema columns and owner cascade', async () => {
    const columns = await db.prepare('PRAGMA table_info(private_notes)').all<{name: string}>();
    expect(columns.results.map((column) => column.name)).toEqual(['id', 'user_id', 'title', 'body', 'pinned', 'created_at']);
    const relations = await db.prepare('PRAGMA foreign_key_list(private_notes)').all<{table: string; on_delete: string}>();
    expect(relations.results).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'user', on_delete: 'CASCADE' })]));
  });
  it('rejects unauthenticated and altered bearer requests with real Better Auth', async () => {
    expect((await handleNotes(request('GET', undefined, ''), dependencies)).status).toBe(401);
    expect((await handleNotes(request('GET', undefined, `${aliceToken}altered`), dependencies)).status).toBe(401);
  });
  it('creates and lists only the signed-in user notes without exposing owner IDs', async () => {
    await create(); await create(bobToken);
    const response = await handleNotes(request(), dependencies);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json() as { notes: unknown[] };
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0]).not.toHaveProperty('userId');
  });
  it('denies cross-user reads/mutations and does not leak whether a note belongs to someone else', async () => {
    const id = await create();
    expect((await handleNotes(request('DELETE', undefined, bobToken, id), dependencies)).status).toBe(404);
    expect((await handleNotes(request('PATCH', { pinned: true }, bobToken, id), dependencies)).status).toBe(404);
    expect((await handleNotes(request('DELETE', undefined, bobToken, crypto.randomUUID()), dependencies)).status).toBe(404);
    expect(await db.prepare('SELECT count(*) AS n FROM private_notes').first('n')).toBe(1);
  });
  it('requires same-origin for writes, including signed-in writes', async () => {
    expect((await handleNotes(request('POST', { title: 'No', body: '' }, aliceToken, undefined, 'https://attacker.example'), dependencies)).status).toBe(403);
    const incoming = request('POST', { title: 'No', body: '' }); incoming.headers.delete('origin');
    expect((await handleNotes(incoming, dependencies)).status).toBe(403);
  });
  it('rejects forged ownership, paid flags, overlong fields and oversized input', async () => {
    for (const value of [{ title: '', body: '' }, { title: 'x'.repeat(121), body: '' }, { title: 'x', body: 'y'.repeat(4001) }, { title: 'x', body: '', userId: bob.id }, { title: 'x', body: '', paid: true }])
      expect((await handleNotes(request('POST', value), dependencies)).status).toBe(400);
    expect((await handleNotes(request('POST', { title: 'x', body: 'y'.repeat(21_000) }), dependencies)).status).toBe(413);
  });
  it('denies pin without entitlement and allows unpin and deletion without payment', async () => {
    const id = await create();
    expect((await handleNotes(request('PATCH', { pinned: true }, aliceToken, id), dependencies)).status).toBe(402);
    expect((await handleNotes(request('PATCH', { pinned: false }, aliceToken, id), dependencies)).status).toBe(200);
    expect((await handleNotes(request('DELETE', undefined, aliceToken, id), dependencies)).status).toBe(200);
  });
  it('uses paid ledger projection, not client flags, and isolates the payer', async () => {
    const id = await create(); await pay(bob);
    expect((await handleNotes(request('PATCH', { pinned: true }, aliceToken, id), dependencies)).status).toBe(402);
    await pay(alice);
    expect((await handleNotes(request('PATCH', { pinned: true }, aliceToken, id), dependencies)).status).toBe(200);
    expect(await db.prepare('SELECT pinned FROM private_notes WHERE id=?').bind(id).first('pinned')).toBe(1);
  });
  it.each(['expired', 'trial', 'wrong-namespace'] as const)('fails closed for %s billing', async (state) => {
    const id = await create(); await pay(alice, state === 'expired' ? now - 1 : now + 60_000, state !== 'trial');
    if (state === 'wrong-namespace') await db.prepare("UPDATE payment_namespaces SET mode='live'").run();
    const response = await handleNotes(request('PATCH', { pinned: true }, aliceToken, id), dependencies);
    expect(response.status).toBe(state === 'wrong-namespace' ? 503 : 402);
    expect(await db.prepare('SELECT pinned FROM private_notes WHERE id=?').bind(id).first('pinned')).toBe(0);
  });
  it('does not give banned users or administrators an ownership bypass', async () => {
    const id = await create();
    await db.prepare("UPDATE user SET role='admin' WHERE id=?").bind(bob.id).run();
    expect((await handleNotes(request('DELETE', undefined, bobToken, id), dependencies)).status).toBe(404);
    await db.prepare('UPDATE user SET banned=1 WHERE id=?').bind(alice.id).run();
    expect((await handleNotes(request(), dependencies)).status).toBe(403);
  });
  it('bounds concurrent creation at 100 rows atomically', async () => {
    await db.batch(Array.from({ length: 99 }, (_, index) => db.prepare('INSERT INTO private_notes(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), alice.id, `n${index}`, '', now)));
    const results = await Promise.all(Array.from({ length: 5 }, () => handleNotes(request('POST', { title: 'last', body: '' }), dependencies)));
    expect(results.filter((response) => response.status === 201)).toHaveLength(1);
    expect(results.filter((response) => response.status === 409)).toHaveLength(4);
    expect(await db.prepare('SELECT count(*) AS n FROM private_notes').first('n')).toBe(100);
  });
  it('cascades notes on user deletion', async () => {
    const id = crypto.randomUUID(); const userId = crypto.randomUUID();
    await db.prepare('INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)').bind(userId, 'Disposable', `${userId}@example.test`, now, now).run();
    await db.prepare('INSERT INTO private_notes(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)').bind(id, userId, 'temporary', '', now).run();
    await db.prepare('DELETE FROM user WHERE id=?').bind(userId).run();
    expect(await db.prepare('SELECT id FROM private_notes WHERE id=?').bind(id).first()).toBeNull();
  });
});
