# Request-scoped storage interfaces

The public server facade supports the documented calls from `@/storage`:

```ts
import { uploadFile, downloadFile, getFileInfo, listUserFiles, deleteFile } from '@/storage';
const result = await uploadFile(buffer, 'note.txt', 'text/plain', {folder:'uploads/docs',userId:session.user.id});
// result: {url,key,metadata}
const page = await listUserFiles(session.user.id); // objects,hasMore,nextCursor
const stream = await downloadFile(result.key);
await getFileInfo(result.key);
await deleteFile(result.key);
```

Call only inside an authenticated server request. The facade resolves Worker bindings and the current session itself. Passing `userId` never authorizes another user's files. Upload/delete require the configured same-origin request, and disabled storage fails closed. Scheduled jobs that already hold trusted server identity can deliberately use the lower-level explicit-binding API in `index.server.ts`; never expose it directly to untrusted inputs.

`url` is an owned `/api/files/:id` download, not a public bucket/CDN URL. Downloads enforce attachment, nosniff and sandbox headers. A returned raw stream must not be served inline with an untrusted declared MIME; use the existing API for browser downloads. Folder input is a bounded relative path. Empty `allowedTypes` allows any extension, with known raster/PDF signature checks, UTF-8/JSON checks where appropriate, and opaque attachment delivery for other content. No claim of malware scanning or aggregate tenant quota is made.

The second optional list argument `{limit,cursor}` is an independent compatible extension; default20,max100 and owner/date/id keyset pagination. Migration0006 adds its covering index. Unit and actual local D1 regressions are in `tests/storage-public-contract.test.ts` and `tests/storage-review.integration.test.ts`.
