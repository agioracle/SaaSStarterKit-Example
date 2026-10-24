import { Modal } from '../ui/modal';
import { useState, type FormEvent } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateFiles } from '../../lib/query-keys';
import { authClient } from '../../auth/client';
import { Route as AppRoute } from '../../routes/_app';
import { websiteConfig } from '../../config/website';
import {
  Button,
  Card,
  Field,
  Notice,
  SectionTitle,
  api,
  errorMessage,
  useResource,
  Loading,
  formatDate,
} from '../ui/primitives';
import { VerificationResend } from '../auth/auth-form';
import { localePath } from '../../locale';
import { m } from '../../locale/paraglide/messages';
import { newsletterOutcome, type NewsletterMutationResult } from '../../newsletter/outcome';
export function ProfilePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = AppRoute.useRouteContext();
  const [name, setName] = useState(session.user.name);
  const [image, setImage] = useState(session.user.image || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await authClient.updateUser({
        name,
        image: image || null,
      });
      if (result.error) throw new Error(result.error.message);
      // Better Auth updates its own session store, not Router beforeLoad context.
      await router.invalidate();
      setMessage(m.settings_account_your_profile_has_been_saved());
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SectionTitle
        title={m.settings_profile()}
        description={m.settings_account_the_details_that_make_this_workspace_yours()}
      />
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <Card
        title={m.settings_account_personal_information()}
        description={m.settings_account_your_name_and_avatar_are_visible_in()}
      >
        <form className="stack" onSubmit={save}>
          <div className="profile-avatar">
            <span className="avatar large">
              {image ? (
                <img src={image} alt={m.settings_account_your_avatar()} />
              ) : (
                name.slice(0, 1)
              )}
            </span>
            <div>
              <strong>{m.settings_account_profile_photo()}</strong>
              <p className="muted">{m.settings_account_upload_an_image_or_use_an_https()}</p>
              {websiteConfig.storage.enabled && (
                <input
                  className="file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  aria-label={m.settings_account_upload_avatar()}
                  disabled={busy}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    setError('');
                    try {
                      const data = new FormData();
                      data.set('file', file);
                      const uploaded = await api<{ url: string }>('/api/files', {
                        method: 'POST',
                        body: data,
                      });
                      setImage(uploaded.url);
                      await invalidateFiles(queryClient, session.user.id);
                    } catch (error) {
                      setError(errorMessage(error));
                    } finally {
                      setBusy(false);
                      event.target.value = '';
                    }
                  }}
                />
              )}
            </div>
          </div>
          <Field
            label={m.auth_name()}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
          />
          <Field
            label={m.settings_account_avatar_url()}
            value={image}
            onChange={(event) => setImage(event.target.value)}
            placeholder="https://…"
            pattern="(https://.*|/api/files/.*)"
          />
          <Field
            label={m.auth_email()}
            value={session.user.email}
            type="email"
            disabled
            hint={m.settings_account_your_verified_sign_in_address_email_changes()}
          />
          <div>
            <Button type="submit" busy={busy}>
              {m.common_save()}
            </Button>
          </div>
        </form>
      </Card>
      <Card title={m.settings_account_email_verification()}>
        {session.user.emailVerified ? (
          <Notice kind="success">{m.settings_account_your_email_address_is_verified()}</Notice>
        ) : (
          <VerificationResend email={session.user.email} />
        )}
      </Card>
    </>
  );
}
interface SessionItem {
  id: string;
  token: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt: string;
  expiresAt: string;
}
export function SecurityPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const sessions = useResource<SessionItem[]>('/api/auth/list-sessions');
  const { session } = AppRoute.useRouteContext();
  return (
    <>
      <SectionTitle
        title={m.settings_security()}
        description={m.settings_account_keep_your_account_and_your_sessions_protected()}
      />
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <Card
        title={m.settings_account_password()}
        description={m.settings_account_use_a_unique_password_of_at_least()}
      >
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            setMessage('');
            try {
              if (newPassword !== confirmPassword)
                throw new Error(m.settings_account_passwords_do_not_match());
              const result = await authClient.changePassword({
                currentPassword,
                newPassword,
                revokeOtherSessions: true,
              });
              if (result.error) throw new Error(result.error.message);
              setMessage(m.settings_account_password_updated_and_other_sessions_revoked());
              setCurrentPassword('');
              setNewPassword('');
              setConfirmPassword('');
              sessions.reload();
            } catch (error) {
              setError(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label={m.settings_account_current_password()}
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <Field
            label={m.settings_account_new_password()}
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <Field
            label={m.settings_account_confirm_new_password()}
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <div className="row">
            <Button type="submit" busy={busy}>
              {m.settings_account_update_password()}
            </Button>
            <a href={localePath('/auth/forgot-password')}>
              {m.settings_account_reset_password_instead()}
            </a>
          </div>
        </form>
      </Card>
      <Card
        title={m.settings_account_active_sessions()}
        description={m.settings_account_review_where_you_re_signed_in_revoking()}
      >
        {sessions.loading ? (
          <Loading />
        ) : sessions.error ? (
          <Notice kind="error">{sessions.error}</Notice>
        ) : (
          <div className="session-list">
            {sessions.data?.map((item) => (
              <div className="session-item" key={item.id}>
                <div>
                  <strong>
                    {item.id === session.session.id
                      ? m.settings_account_this_device()
                      : item.userAgent || m.settings_account_unknown_device()}
                  </strong>
                  <p>
                    {item.ipAddress || m.settings_account_ip_unavailable()} ·{' '}
                    {m.settings_account_expires()} {formatDate(item.expiresAt)}
                  </p>
                </div>
                {item.id === session.session.id ? (
                  <span className="badge success">{m.settings_account_current()}</span>
                ) : (
                  <Button
                    variant="secondary"
                    busy={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const result = await authClient.revokeSession({
                          token: item.token,
                        });
                        if (result.error) throw new Error(result.error.message);
                        sessions.reload();
                      } catch (error) {
                        setError(errorMessage(error));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {m.settings_account_revoke()}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      {websiteConfig.auth.deleteUser && (
        <Card
          title={m.settings_account_delete_account()}
          description={m.settings_account_this_permanently_removes_your_account_and_its()}
        >
          <Button variant="danger" onClick={() => setDeleting(true)}>
            {m.settings_account_delete_my_account()}
          </Button>
        </Card>
      )}
      {deleting && (
        <Modal
          error={error}
          title={m.settings_account_confirm_account_deletion()}
          onClose={() => {
            setDeleting(false);
            setDeletePassword('');
            setDeleteText('');
          }}
        >
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                const result = await authClient.deleteUser({
                  password: deletePassword || undefined,
                  callbackURL: localePath('/'),
                });
                if (result.error) throw new Error(result.error.message);
                setDeleting(false);
                setDeletePassword('');
                setMessage(m.settings_account_check_your_inbox_to_confirm_account_deletion());
              } catch (error) {
                setError(errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Notice kind="error">
              {m.settings_account_this_removes_your_account_and_stored_files()}
            </Notice>
            <Field
              label={m.settings_account_type_delete_to_confirm()}
              required
              value={deleteText}
              onChange={(event) => setDeleteText(event.target.value)}
            />
            <Field
              label={m.settings_account_password_if_you_have_one()}
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
            />
            <div className="row">
              <Button variant="secondary" type="button" onClick={() => setDeleting(false)}>
                {m.common_cancel()}
              </Button>
              <Button variant="danger" busy={busy} disabled={deleteText !== 'DELETE'} type="submit">
                {m.settings_account_request_deletion()}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function NotificationsPage() {
  return websiteConfig.newsletter.enabled ? (
    <NewsletterPreferences />
  ) : (
    <Notice>{m.settings_account_newsletter_subscriptions_are_not_enabled()}</Notice>
  );
}
function NewsletterPreferences() {
  const status = useResource<{ subscribed: boolean }>('/api/newsletter');
  const [consent, setConsent] = useState(false);
  const [resubscribe, setResubscribe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<ReturnType<typeof newsletterOutcome> | null>(null);
  return (
    <>
      <SectionTitle
        title={m.settings_notifications()}
        description={m.settings_account_choose_what_lands_in_your_inbox()}
      />
      <Card
        title={m.settings_account_product_newsletter()}
        description={m.settings_account_occasional_product_updates_and_useful_ideas_you()}
      >
        {error && <Notice kind="error">{error}</Notice>}
        {outcome && <Notice kind={outcome.kind}>{outcome.message}</Notice>}
        {status.loading ? (
          <Loading />
        ) : status.error ? (
          <>
            <Notice kind="error">{status.error}</Notice>
            <Button variant="secondary" onClick={status.reload}>
              {m.common_retry()}
            </Button>
          </>
        ) : (
          <div className="stack">
            <div className="row between">
              <div>
                <strong>{m.settings_account_subscription_status()}</strong>
                <p>
                  {status.data?.subscribed
                    ? m.settings_account_you_are_subscribed()
                    : m.settings_account_you_are_not_subscribed()}
                </p>
              </div>
              <span className="badge">
                {status.data?.subscribed
                  ? m.settings_account_subscribed()
                  : m.settings_account_not_subscribed()}
              </span>
            </div>
            {!status.data?.subscribed && (
              <>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  <span>{m.settings_account_i_agree_to_receive_product_emails_at()}</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={resubscribe}
                    onChange={(event) => setResubscribe(event.target.checked)}
                  />
                  <span>
                    {m.settings_account_if_i_previously_unsubscribed_subscribe_me_again()}
                  </span>
                </label>
              </>
            )}
            <div>
              <Button
                variant={status.data?.subscribed ? 'secondary' : 'primary'}
                busy={busy}
                disabled={!status.data?.subscribed && !consent}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  setOutcome(null);
                  try {
                    const next = !status.data?.subscribed;
                    const response = await api<NewsletterMutationResult>('/api/newsletter', {
                      method: next ? 'POST' : 'DELETE',
                      body: JSON.stringify(next ? { consent: true, resubscribe } : {}),
                    });
                    setOutcome(newsletterOutcome(response, next));
                    status.reload();
                    setConsent(false);
                    setResubscribe(false);
                  } catch (error) {
                    setError(errorMessage(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {status.data?.subscribed
                  ? m.settings_account_unsubscribe()
                  : m.settings_account_subscribe()}
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Notice>{m.settings_account_essential_security_and_account_emails_are_not()}</Notice>
    </>
  );
}
