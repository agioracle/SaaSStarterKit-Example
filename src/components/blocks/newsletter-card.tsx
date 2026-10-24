import { m } from '../../locale/paraglide/messages';
import { ArrowRight, Mail } from 'lucide-react';
import { useState } from 'react';
import { localePath } from '../../locale';
import { Button, Notice, api, errorMessage } from '../ui/core';
import { authClient } from '../../auth/client';
import { websiteConfig } from '../../config/website';
import { newsletterOutcome, type NewsletterMutationResult } from '../../newsletter/outcome';
export function NewsletterCard() {
  const { data: session } = authClient.useSession();
  const [consent, setConsent] = useState(false);
  const [resubscribe, setResubscribe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<ReturnType<typeof newsletterOutcome> | null>(null);
  if (!websiteConfig.newsletter.enabled || !websiteConfig.auth.enabled) return null;
  return (
    <section className="newsletter-section container">
      <div>
        <Mail size={27} />
        <h2>{m.blocks_newsletter_card_good_ideas_occasionally()}</h2>
        <p>{m.blocks_newsletter_card_product_notes_and_useful_things_no_noise()}</p>
      </div>
      <div>
        {outcome && <Notice kind={outcome.kind}>{outcome.message}</Notice>}
        {!outcome?.confirmed &&
          (session ? (
            <form
              className="stack"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                setOutcome(null);
                try {
                  const response = await api<NewsletterMutationResult>('/api/newsletter', {
                    method: 'POST',
                    body: JSON.stringify({ consent: true, resubscribe }),
                  });
                  setOutcome(newsletterOutcome(response, true));
                } catch (error) {
                  setError(errorMessage(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  required
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  {m.blocks_newsletter_card_send_product_emails_to({ value1: session.user.email })}
                </span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={resubscribe}
                  onChange={(event) => setResubscribe(event.target.checked)}
                />
                <span>
                  {m.blocks_newsletter_card_if_i_previously_unsubscribed_subscribe_me_again()}
                </span>
              </label>
              <Button type="submit" busy={busy} disabled={!consent}>
                {m.blocks_newsletter_card_keep_me_in_the_loop()}
                <ArrowRight size={16} />
              </Button>
            </form>
          ) : (
            <a
              className="button primary"
              href={`${localePath('/auth/login')}?redirect=${encodeURIComponent('/settings/notifications')}`}
            >
              {m.blocks_newsletter_card_sign_in_to_subscribe()}
              <ArrowRight size={16} />
            </a>
          ))}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </section>
  );
}
export default NewsletterCard;
