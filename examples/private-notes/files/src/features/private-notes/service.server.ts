import { z } from 'zod';
import { assertSameOrigin, errorResponse, HttpError, json, readJson } from '@/lib/security';

export interface NoteUser { id: string; email: string }
export interface PrivateNote { id: string; title: string; body: string; pinned: number; createdAt: number }
export interface NotesDependencies {
  db: D1Database;
  origin: string;
  authenticate: (request: Request) => Promise<NoteUser>;
  hasPaidAccess: (user: NoteUser) => Promise<boolean>;
  now?: () => number;
}
const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(4000),
}).strict();
const updateSchema = z.object({ pinned: z.boolean() }).strict();
const select = 'SELECT id,title,body,pinned,created_at AS createdAt FROM private_notes';

/** Server boundary: no user ID, role, paid flag, or SQL is accepted from the browser. */
export async function handleNotes(request: Request, dependencies: NotesDependencies): Promise<Response> {
  try {
    const path = new URL(request.url).pathname;
    if (path !== '/api/private-notes') throw new HttpError(404, 'Not found.');
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method))
      throw new HttpError(405, 'Method not allowed.');
    if (request.method !== 'GET') assertSameOrigin(request, dependencies.origin);
    const user = await dependencies.authenticate(request);
    const { db } = dependencies;
    if (request.method === 'GET') {
      // A bounded teaching example, not an unbounded feed. Creation is also capped atomically.
      const result = await db.prepare(`${select} WHERE user_id=? ORDER BY pinned DESC,created_at DESC,id DESC LIMIT 100`).bind(user.id).all<PrivateNote>();
      return json({ notes: result.results });
    }
    if (request.method === 'POST') {
      const input = createSchema.parse(await readJson(request, 20_000));
      const id = crypto.randomUUID();
      const at = (dependencies.now ?? Date.now)();
      const result = await db.prepare('INSERT INTO private_notes(id,user_id,title,body,pinned,created_at) SELECT ?,?,?,?,0,? WHERE (SELECT count(*) FROM private_notes WHERE user_id=?) < 100')
        .bind(id, user.id, input.title, input.body, at, user.id).run();
      if (!result.meta.changes) throw new HttpError(409, 'This example allows at most 100 notes. Delete a note first.');
      return json({ note: { id, title: input.title, body: input.body, pinned: 0, createdAt: at } }, 201);
    }
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !z.string().uuid().safeParse(id).success) throw new HttpError(400, 'Invalid note ID.');
    // The SAME ownership condition is used in both lookup and mutation. Admins have no implicit bypass.
    const owned = await db.prepare(`${select} WHERE id=? AND user_id=?`).bind(id, user.id).first<PrivateNote>();
    if (!owned) throw new HttpError(404, 'Note not found.');
    if (request.method === 'DELETE') {
      await db.prepare('DELETE FROM private_notes WHERE id=? AND user_id=?').bind(id, user.id).run();
      return json({ ok: true });
    }
    const { pinned } = updateSchema.parse(await readJson(request, 1024));
    // Unpin remains available after expiry. Payment is rechecked for every new pin on the server.
    if (pinned && !(await dependencies.hasPaidAccess(user))) throw new HttpError(402, 'An active paid plan is required to pin notes.');
    await db.prepare('UPDATE private_notes SET pinned=? WHERE id=? AND user_id=?').bind(pinned ? 1 : 0, id, user.id).run();
    return json({ note: { ...owned, pinned: pinned ? 1 : 0 } });
  } catch (error) {
    return errorResponse(error, { operation: 'private-notes.request' });
  }
}
