import { useId, useState } from 'react';
import { useRouteContext } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Empty, Field, Notice, SectionTitle } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api-client';
import { getLocale, localePath } from '@/locale';
import { noteMessages } from './messages';
import type { PrivateNote } from './service.server';

export function PrivateNotesPage() {
  const { session } = useRouteContext({ from: '/_app' });
  return <NotesView key={session.user.id} userId={session.user.id} />;
}
function NotesView({ userId }: { userId: string }) {
  const text = noteMessages[getLocale() === 'zh' ? 'zh' : 'en'];
  const bodyId = useId();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [success, setSuccess] = useState('');
  const client = useQueryClient();
  const key = ['private-notes', userId] as const;
  const notes = useQuery({ queryKey: key, queryFn: ({ signal }) => api<{ notes: PrivateNote[] }>('/api/private-notes', { signal }), retry: false });
  const mutation = useMutation({
    mutationFn: async (input: { method: 'POST' | 'PATCH' | 'DELETE'; id?: string; pinned?: boolean }) => {
      setSuccess('');
      await api(`/api/private-notes${input.id ? `?id=${encodeURIComponent(input.id)}` : ''}`, {
        method: input.method,
        body: input.method === 'POST' ? JSON.stringify({ title, body }) : input.method === 'PATCH' ? JSON.stringify({ pinned: input.pinned }) : undefined,
      });
      if (input.method === 'POST') { setTitle(''); setBody(''); }
      return input.method;
    },
    onSuccess: async (method) => {
      await client.invalidateQueries({ queryKey: key });
      setSuccess(method === 'POST' ? text.saved : method === 'DELETE' ? text.deleted : text.updated);
    },
  });
  return <div className="page-stack">
    <SectionTitle title={text.title} description={text.intro} />
    <a href={localePath('/dashboard')}>{text.back}</a>
    <Card title={text.create}>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate({ method: 'POST' }); }}>
        <Field label={text.titleLabel} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required disabled={mutation.isPending} />
        <label htmlFor={bodyId}>{text.bodyLabel}</label>
        <textarea id={bodyId} value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} disabled={mutation.isPending} />
        <small>{text.limit}</small>
        <Button type="submit" busy={mutation.isPending} disabled={!title.trim()}>{text.create}</Button>
      </form>
    </Card>
    {mutation.error && <Notice kind="error">{errorMessage(mutation.error)}</Notice>}
    {success && <Notice kind="success">{success}</Notice>}
    {notes.isPending ? <p role="status">{text.loading}</p> : notes.error ? <Notice kind="error">{errorMessage(notes.error)} <Button onClick={() => void notes.refetch()}>{text.retry}</Button></Notice> : !notes.data?.notes.length ? <Empty title={text.empty}>{text.emptyBody}</Empty> : notes.data.notes.map((note) => <Card key={note.id} title={`${note.pinned ? '★ ' : ''}${note.title}`}>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.body}</p>
      <div className="row">
        <Button type="button" variant="secondary" busy={mutation.isPending} onClick={() => mutation.mutate({ method: 'PATCH', id: note.id, pinned: !note.pinned })}>{note.pinned ? text.unpin : text.pin}</Button>
        <Button type="button" variant="danger" busy={mutation.isPending} onClick={() => { if (window.confirm(text.confirmDelete)) mutation.mutate({ method: 'DELETE', id: note.id }); }}>{text.remove}</Button>
      </div>
    </Card>)}
  </div>;
}
