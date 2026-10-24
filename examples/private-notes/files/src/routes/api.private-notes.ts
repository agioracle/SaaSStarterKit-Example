import { createFileRoute } from '@tanstack/react-router';
async function handle({ request }: { request: Request }) {
  const { privateNotesRequest } = await import('@/features/private-notes/runtime.server');
  return privateNotesRequest(request);
}
export const Route = createFileRoute('/api/private-notes')({
  server: { handlers: { GET: handle, POST: handle, PATCH: handle, DELETE: handle } },
});
