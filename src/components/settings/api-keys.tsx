import { Modal } from '../ui/modal';
import { useToast } from '../shared/toaster';
import { m } from '../../locale/paraglide/messages';
import { useState } from 'react';
import { Copy, Plus, Trash2, Check } from 'lucide-react';

import {
  Button,
  Card,
  Empty,
  Field,
  Loading,
  Notice,
  SectionTitle,
  api,
  errorMessage,
  formatDate,
  useResource,
} from '../ui/primitives';
interface ApiKey {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  createdAt: string;
  expiresAt: string | null;
  enabled: boolean;
}
export function ApiKeysPage() {
  const { toast } = useToast();
  const keys = useResource<{ apiKeys: ApiKey[] }>('/api/auth/api-key/list');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [expires, setExpires] = useState('90');
  const [revealed, setRevealed] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<ApiKey | null>(null);
  return (
    <>
      <SectionTitle
        title={m.settings_api_keys_api_keys()}
        description={m.settings_api_keys_connect_your_tools_without_sharing_your_password()}
        action={
          <Button
            onClick={() => {
              setCreating(true);
              setError('');
            }}
          >
            <Plus size={16} />
            {m.settings_api_keys_create_api_key()}
          </Button>
        }
      />
      {error && <Notice kind="error">{error}</Notice>}
      <Card>
        {keys.loading ? (
          <Loading />
        ) : keys.error ? (
          <Notice kind="error">{keys.error}</Notice>
        ) : keys.data?.apiKeys?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{m.settings_api_keys_name()}</th>
                  <th>{m.settings_api_keys_key()}</th>
                  <th>{m.settings_api_keys_created()}</th>
                  <th>{m.settings_api_keys_expires()}</th>
                  <th>
                    <span className="sr-only">{m.settings_api_keys_actions()}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.data.apiKeys.map((key) => (
                  <tr key={key.id}>
                    <td>
                      <strong>{key.name || m.settings_api_keys_untitled_key()}</strong>
                    </td>
                    <td>
                      <code>{key.prefix || 'ek_'}••••••••••••</code>
                    </td>
                    <td>{formatDate(key.createdAt)}</td>
                    <td>{formatDate(key.expiresAt)}</td>
                    <td>
                      <button
                        className="icon-button danger-text"
                        aria-label={m.settings_api_keys_delete({ value1: key.name || key.id })}
                        onClick={() => setDeleting(key)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={m.settings_api_keys_no_api_keys_yet()}>
            {m.settings_api_keys_create_a_named_key_for_your_first()}
          </Empty>
        )}
      </Card>
      <Notice>{m.settings_api_keys_treat_api_keys_like_passwords_keep_them()}</Notice>
      {creating && (
        <Modal
          error={error}
          title={m.settings_api_keys_create_api_key()}
          onClose={() => {
            setCreating(false);
            setName('');
          }}
        >
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                const result = await api<{ key: string }>('/api/auth/api-key/create', {
                  method: 'POST',
                  body: JSON.stringify({
                    name,
                    ...(expires !== 'never' ? { expiresIn: Number(expires) * 86400 } : {}),
                  }),
                });
                if (!result.key)
                  throw new Error(m.settings_api_keys_the_server_did_not_return_a_key());
                setRevealed(result.key);
                setCopied(false);
                setCreating(false);
                setName('');
                keys.reload();
              } catch (error) {
                setError(errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field
              label={m.settings_api_keys_key_name()}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={64}
              placeholder={m.settings_api_keys_my_integration()}
            />
            <label className="field">
              {m.settings_api_keys_expiration()}
              <select value={expires} onChange={(event) => setExpires(event.target.value)}>
                <option value="30">{m.settings_api_keys_30_days()}</option>
                <option value="90">{m.settings_api_keys_90_days()}</option>
                <option value="365">{m.settings_api_keys_1_year()}</option>
                <option value="never">{m.settings_api_keys_never()}</option>
              </select>
            </label>
            <Button type="submit" busy={busy}>
              {m.settings_api_keys_create_key()}
            </Button>
          </form>
        </Modal>
      )}
      {revealed && (
        <Modal
          error={error}
          title={m.settings_api_keys_save_your_new_key()}
          onClose={() => setRevealed('')}
        >
          <div className="stack">
            <Notice>{m.settings_api_keys_this_is_the_only_time_the_full()}</Notice>
            <div className="secret-key">
              <code>{revealed}</code>
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(revealed);
                    setCopied(true);
                    toast({ title: m.settings_api_keys_copied(), kind: 'success' });
                  } catch {
                    setError(m.settings_api_keys_clipboard_access_failed_select_and_copy_the());
                    toast({
                      title: m.settings_api_keys_clipboard_access_failed_select_and_copy_the(),
                      kind: 'error',
                    });
                  }
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
                {copied ? m.settings_api_keys_copied() : m.settings_api_keys_copy()}
              </Button>
            </div>
            <Button onClick={() => setRevealed('')}>
              {m.settings_api_keys_i_have_saved_this_key()}
            </Button>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal
          error={error}
          title={m.settings_api_keys_delete_api_key()}
          onClose={() => setDeleting(null)}
        >
          <div className="stack">
            <p>
              {m.settings_api_keys_will_stop_working_immediately_this_cannot_be({
                value1: deleting.name || deleting.id,
              })}
            </p>
            <div className="row">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                {m.settings_api_keys_cancel()}
              </Button>
              <Button
                variant="danger"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api('/api/auth/api-key/delete', {
                      method: 'POST',
                      body: JSON.stringify({ keyId: deleting.id }),
                    });
                    setDeleting(null);
                    keys.reload();
                  } catch (error) {
                    setError(errorMessage(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {m.settings_api_keys_delete_key()}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
