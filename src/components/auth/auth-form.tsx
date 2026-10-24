import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { authClient } from '../../auth/client';
import { websiteConfig } from '../../config/website';
import { m } from '../../locale/paraglide/messages';
import { localePath, safeReturnPath } from '../../locale';
import { Button, Field, Notice, errorMessage } from '../ui/primitives';
export function VerificationResend({ email }: { email: string }) {
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  if (!websiteConfig.auth.enabled) return null;
  return (
    <div className="stack">
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <Button
        variant="secondary"
        busy={busy}
        disabled={remaining > 0 || !email}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const result = await authClient.sendVerificationEmail({
              email,
              callbackURL: localePath('/dashboard'),
            });
            if (result.error) throw new Error(result.error.message);
            setRemaining(60);
            setMessage(m.auth_auth_form_verification_email_sent_please_check_your_inbox());
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {remaining > 0
          ? m.auth_auth_form_resend_in_s({ value1: remaining })
          : m.auth_auth_form_resend_verification_email()}
      </Button>
    </div>
  );
}
export function AuthForm({
  mode,
  redirectTo = '/dashboard',
  googleEnabled = false,
  token,
  errorCode,
}: {
  mode: 'login' | 'register' | 'forgot' | 'reset' | 'error';
  redirectTo?: string;
  googleEnabled?: boolean;
  token?: string;
  errorCode?: string;
}) {
  const [newsletterConsent, setNewsletterConsent] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [socialBusy, setSocialBusy] = useState(false);
  const title =
    mode === 'login'
      ? m.auth_login_title()
      : mode === 'register'
        ? m.auth_register_title()
        : mode === 'forgot'
          ? m.auth_auth_form_forgot_your_password()
          : mode === 'reset'
            ? m.auth_auth_form_a_fresh_start()
            : m.auth_auth_form_let_s_get_you_back_on_track();
  const subtitle =
    mode === 'login'
      ? m.auth_auth_form_sign_in_to_pick_up_where_you()
      : mode === 'register'
        ? m.auth_auth_form_create_your_account_the_next_chapter_is()
        : mode === 'forgot'
          ? m.auth_auth_form_enter_your_email_and_we_ll_send()
          : mode === 'reset'
            ? m.auth_auth_form_choose_a_strong_password_you_haven_t()
            : m.auth_auth_form_this_sign_in_or_verification_link_could();
  if (!websiteConfig.auth.enabled)
    return (
      <div className="container error-page">
        <h1>{m.auth_disabled_title()}</h1>
        <Notice>{m.auth_disabled_description()}</Notice>
        <a href={localePath('/')}>{m.routes_root_back_to_home()}</a>
      </div>
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'login') {
        const result = await authClient.signIn.email({
          email,
          password,
          callbackURL: localePath(safeReturnPath(redirectTo)),
        });
        if (result.error) {
          if (result.error.code === 'EMAIL_NOT_VERIFIED') setNeedsVerification(true);
          throw new Error(result.error.message);
        }
        window.location.assign(localePath(safeReturnPath(redirectTo)));
      }
      if (mode === 'register') {
        if (password !== confirm) throw new Error(m.auth_auth_form_passwords_do_not_match());
        const result = await authClient.signUp.email({
          email,
          password,
          name,
          newsletterConsent: websiteConfig.newsletter.autoSubscribe && newsletterConsent,
          callbackURL: localePath('/dashboard'),
        });
        if (result.error) throw new Error(result.error.message);
        setMessage(m.auth_auth_form_your_account_has_been_created_check_your());
        setNeedsVerification(true);
        setPassword('');
        setConfirm('');
      }
      if (mode === 'forgot') {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: localePath('/auth/reset-password'),
        });
        if (result.error) throw new Error(result.error.message);
        setMessage(m.auth_auth_form_if_an_account_exists_for_that_address());
      }
      if (mode === 'reset') {
        if (!token) throw new Error(m.auth_auth_form_the_reset_link_is_missing_its_token());
        if (password !== confirm) throw new Error(m.auth_auth_form_passwords_do_not_match());
        const result = await authClient.resetPassword({ newPassword: password, token });
        if (result.error) throw new Error(result.error.message);
        setMessage(m.auth_auth_form_password_updated_you_can_now_sign_in());
        setPassword('');
        setConfirm('');
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-aside">
        <span className="eyebrow">{websiteConfig.name} / WORKSPACE</span>
        <h2>{m.auth_auth_form_good_things_start_with_a_little_space()}</h2>
        <p>{m.auth_auth_form_one_thoughtful_workspace_for_everything_you_re()}</p>
        <div className="auth-art">
          <span>✳</span>
          <div className="art-orbit" />
          <span className="tiny-star">✦</span>
        </div>
        <div className="auth-assurance">
          <ShieldCheck size={18} />
          {m.auth_auth_form_your_workspace_your_possibilities()}
        </div>
      </div>
      <div className="auth-content">
        <a className="back-link" href={localePath('/')}>
          <ArrowLeft size={15} />
          {m.auth_auth_form_back_to_home()}
        </a>
        <div className="auth-form">
          <span className="eyebrow">{m.auth_auth_form_welcome_to_edgekit()}</span>
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {error && <Notice kind="error">{error}</Notice>}
          {message && <Notice kind="success">{message}</Notice>}
          {mode === 'error' ? (
            <>
              <Notice kind="error">
                {errorCode
                  ? m.auth_auth_form_authentication_error({ value1: errorCode })
                  : m.auth_auth_form_the_link_may_have_expired_or_the()}
              </Notice>
              <a className="button primary" href={localePath('/auth/login')}>
                {m.auth_auth_form_return_to_sign_in()}
              </a>
              <a href={localePath('/auth/forgot-password')}>
                {m.auth_auth_form_request_a_new_password_reset_link()}
              </a>
            </>
          ) : (
            <>
              {(mode === 'login' || mode === 'register') && websiteConfig.auth.google && googleEnabled && (
                <>
                  <Button
                    variant="secondary"
                    busy={socialBusy}
                    onClick={async () => {
                      setSocialBusy(true);
                      setError('');
                      try {
                        const result = await authClient.signIn.social({
                          provider: 'google',
                          callbackURL: localePath(safeReturnPath(redirectTo)),
                          errorCallbackURL: localePath('/auth/error'),
                        });
                        if (result.error) throw new Error(result.error.message);
                      } catch (error) {
                        setError(errorMessage(error));
                        setSocialBusy(false);
                      }
                    }}
                  >
                    <span className="google-mark">G</span>
                    {m.auth_google()}
                  </Button>
                  <div className="divider-text">
                    <span>{m.auth_auth_form_or_continue_with_email()}</span>
                  </div>
                </>
              )}
              {websiteConfig.auth.credentials || mode === 'forgot' || mode === 'reset' ? (
                <form onSubmit={submit} className="stack">
                  {mode === 'register' && (
                    <Field
                      label={m.auth_name()}
                      autoComplete="name"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={80}
                    />
                  )}{' '}
                  {mode !== 'reset' && (
                    <Field
                      label={m.auth_email()}
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  )}{' '}
                  {mode !== 'forgot' && (
                    <Field
                      label={m.auth_password()}
                      type="password"
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      minLength={mode === 'login' ? 1 : 10}
                      maxLength={128}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      hint={
                        mode === 'login' ? undefined : m.auth_auth_form_at_least_10_characters()
                      }
                    />
                  )}{' '}
                  {(mode === 'register' || mode === 'reset') && (
                    <Field
                      label={m.auth_auth_form_confirm_password()}
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={10}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  )}{' '}
                  {mode === 'register' &&
                    websiteConfig.newsletter.enabled &&
                    websiteConfig.newsletter.autoSubscribe && (
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={newsletterConsent}
                          onChange={(event) => setNewsletterConsent(event.target.checked)}
                        />
                        <span>
                          {m.auth_auth_form_email_me_occasional_product_updates_after_i()}
                        </span>
                      </label>
                    )}
                  {mode === 'login' && (
                    <a className="form-forgot" href={localePath('/auth/forgot-password')}>
                      {m.auth_auth_form_forgot_password()}
                    </a>
                  )}
                  {mode === 'reset' && !token && (
                    <Notice kind="error">
                      {m.auth_auth_form_this_link_is_incomplete_request_a_new()}
                    </Notice>
                  )}
                  <Button type="submit" busy={busy} disabled={mode === 'reset' && !token}>
                    {mode === 'login'
                      ? m.auth_login_action()
                      : mode === 'register'
                        ? m.auth_register_action()
                        : mode === 'forgot'
                          ? m.auth_auth_form_send_reset_instructions()
                          : m.auth_auth_form_update_password()}
                  </Button>
                </form>
              ) : (
                <Notice>{m.auth_auth_form_email_sign_in_is_disabled_for_this()}</Notice>
              )}
              {needsVerification && email && <VerificationResend email={email} />}
              <p className="auth-switch">
                {mode === 'login' ? (
                  <>
                    {m.auth_auth_form_new_here()}{' '}
                    <a href={localePath('/auth/register')}>
                      {m.auth_auth_form_create_an_account()}
                    </a>
                  </>
                ) : (
                  <a href={localePath('/auth/login')}>
                    {m.auth_auth_form_already_have_an_account_sign_in()}
                  </a>
                )}
              </p>
              {mode === 'register' && (
                <p className="fine-print">
                  {m.auth_auth_form_by_creating_an_account_you_agree_to()}
                  <a href={localePath('/terms')}>{m.auth_auth_form_terms()}</a>
                  {m.auth_auth_form_and()}
                  <a href={localePath('/privacy')}>{m.auth_auth_form_privacy_policy()}</a>.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
