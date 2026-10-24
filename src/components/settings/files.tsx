import { Modal } from '../ui/modal';
import { getLocale } from '../../locale';
import { m } from '../../locale/paraglide/messages';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Route as AppRoute } from '../../routes/_app';
import { invalidateFiles, queryKeys } from '../../lib/query-keys';
import { Upload, Trash2, Download, Image, FileText } from 'lucide-react';
import { websiteConfig } from '../../config/website';
import { validateUpload } from '../../storage';

import {
  Button,
  Card,
  Empty,
  Loading,
  Notice,
  SectionTitle,
  api,
  errorMessage,
  formatDate,
  useResource,
} from '../ui/primitives';
interface StoredFile {
  id: string;
  name: string;
  url: string;
  contentType: string;
  size: number;
  createdAt: string;
}
const fileExtensions = websiteConfig.storage.allowedTypes.map((value) =>
  value.replace(/^\./, '').toLowerCase(),
);
const fileAccept = fileExtensions.length
  ? fileExtensions.map((extension) => `.${extension}`).join(',')
  : undefined;
const safePreview = (type: string) =>
  ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type);

const maxMegabytes = websiteConfig.storage.maxSize / 1024 / 1024;
export function FilesPage() {
  const { session } = AppRoute.useRouteContext();
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState('');
  const [previous, setPrevious] = useState<string[]>([]);
  const files = useResource<{ files: StoredFile[]; hasMore: boolean; nextCursor: string | null }>(
    `/api/files?cursor=${encodeURIComponent(cursor)}`,
    queryKeys.fileList(session.user.id, cursor),
  );
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<StoredFile | null>(null);
  const [preview, setPreview] = useState<StoredFile | null>(null);
  async function upload(file: File) {
    setError('');
    try {
      validateUpload(file, websiteConfig.storage.allowedTypes, websiteConfig.storage.maxSize);
    } catch (error) {
      setError(errorMessage(error));
      if (input.current) input.current.value = '';
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set('file', file);
      await api('/api/files', { method: 'POST', body });
      setCursor('');
      setPrevious([]);
      await invalidateFiles(queryClient, session.user.id);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <>
      <SectionTitle
        title={m.settings_files_files()}
        description={m.settings_files_your_private_files_stored_on_cloudflare_r2()}
        action={
          <Button busy={busy} onClick={() => input.current?.click()}>
            <Upload size={16} />
            {m.settings_files_upload_file()}
          </Button>
        }
      />
      <input
        className="sr-only"
        ref={input}
        type="file"
        accept={fileAccept}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
        aria-label={m.settings_files_choose_file_to_upload()}
      />
      {error && <Notice kind="error">{error}</Notice>}
      <Card>
        <button disabled={busy} className="upload-zone" onClick={() => input.current?.click()}>
          <Upload size={26} />
          <strong>
            {busy ? m.settings_files_uploading() : m.settings_files_choose_a_file_to_upload()}
          </strong>
          <span>
            {fileExtensions.length
              ? fileExtensions.join(', ').toUpperCase()
              : m.settings_files_all_extensions_with_content_validation()}{' '}
            · {m.settings_files_up_to_mb({ value1: maxMegabytes })}
          </span>
        </button>
        {files.loading ? (
          <Loading />
        ) : files.error ? (
          <Notice kind="error">{files.error}</Notice>
        ) : !files.data?.files.length ? (
          <Empty title={m.settings_files_a_clean_canvas()}>
            {m.settings_files_your_uploaded_files_will_appear_here_they()}
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{m.settings_files_file()}</th>
                  <th>{m.settings_files_size()}</th>
                  <th>{m.settings_files_uploaded()}</th>
                  <th>{m.settings_files_actions()}</th>
                </tr>
              </thead>
              <tbody>
                {files.data.files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      {safePreview(file.contentType) ? (
                        <button className="file-name" onClick={() => setPreview(file)}>
                          <Image size={18} />
                          {file.name}
                        </button>
                      ) : (
                        <a className="file-name" href={file.url} download={file.name}>
                          <FileText size={18} />
                          {file.name}
                        </a>
                      )}
                    </td>
                    <td>
                      {new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(
                        file.size / 1024,
                      )}{' '}
                      KB
                    </td>
                    <td>{formatDate(file.createdAt)}</td>
                    <td>
                      <div className="row">
                        <a
                          className="icon-button"
                          href={file.url}
                          download={file.name}
                          aria-label={m.settings_files_download({ value1: file.name })}
                        >
                          <Download size={17} />
                        </a>
                        <button
                          className="icon-button danger-text"
                          onClick={() => setDeleting(file)}
                          aria-label={m.settings_files_delete({ value1: file.name })}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>{m.settings_files_page({ value1: previous.length + 1 })}</span>
          <div className="row">
            <Button
              variant="secondary"
              disabled={!previous.length || files.loading}
              onClick={() => {
                setCursor(previous[previous.length - 1] || '');
                setPrevious((values) => values.slice(0, -1));
              }}
            >
              {m.settings_files_previous()}
            </Button>
            <Button
              variant="secondary"
              disabled={!files.data?.hasMore || files.loading}
              onClick={() => {
                setPrevious((values) => [...values, cursor]);
                setCursor(files.data?.nextCursor || '');
              }}
            >
              {m.settings_files_next()}
            </Button>
          </div>
        </div>
      </Card>
      {deleting && (
        <Modal
          error={error}
          title={m.settings_files_delete_file()}
          onClose={() => setDeleting(null)}
        >
          <div className="stack">
            <p>{m.settings_files_will_be_permanently_removed({ value1: deleting.name })}</p>
            <div className="row">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                {m.settings_files_cancel()}
              </Button>
              <Button
                busy={busy}
                variant="danger"
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api('/api/files', {
                      method: 'DELETE',
                      body: JSON.stringify({ id: deleting.id }),
                    });
                    setDeleting(null);
                    // Reset to a valid page even after deleting the last record on a later page.
                    setCursor('');
                    setPrevious([]);
                    await invalidateFiles(queryClient, session.user.id);
                  } catch (error) {
                    setError(errorMessage(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {m.settings_files_delete_file_688103()}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {preview && safePreview(preview.contentType) && (
        <Modal error={error} title={preview.name} onClose={() => setPreview(null)}>
          <img className="file-preview" src={preview.url} alt={preview.name} />
        </Modal>
      )}
    </>
  );
}
