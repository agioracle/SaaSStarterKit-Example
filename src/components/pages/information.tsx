import { websiteConfig } from '../../config/website';
import { m } from '../../locale/paraglide/messages';
import { useState } from 'react';
import { ArrowUpRight, Layers3, ShieldCheck, Globe2 } from 'lucide-react';
import { localePath } from '../../locale';
import { Button, Card, Field, Notice, SectionTitle, api, errorMessage } from '../ui/core';
import { NewsletterCard } from '../blocks/newsletter-card';
export function AboutPage() {
  return (
    <div className="container info-page">
      <SectionTitle
        eyebrow={m.pages_information_a_thoughtful_foundation()}
        title={m.pages_information_less_plumbing_more_possibility()}
        description={m.pages_information_edgekit_is_an_independently_authored_cloudflare_native()}
      />
      <div className="prose">
        <p>{m.pages_information_we_believe_a_useful_starting_point_should()}</p>
        <h2>{m.pages_information_built_independently_with_open_foundations()}</h2>
        <p>{m.pages_information_this_implementation_uses_tanstack_start_react_better()}</p>
        <h2>{m.pages_information_honest_about_what_is_ready()}</h2>
        <p>{m.pages_information_optional_services_need_real_configuration_payments_need()}</p>
      </div>
      <div className="grid three about-values">
        {[
          [
            Layers3,
            m.pages_information_connected(),
            m.pages_information_one_account_thoughtful_modules(),
          ],
          [
            ShieldCheck,
            m.pages_information_considered(),
            m.pages_information_clear_boundaries_and_honest_states(),
          ],
          [
            Globe2,
            m.pages_information_open_to_possibility(),
            m.pages_information_a_starting_point_you_can_make_your(),
          ],
        ].map(([Icon, title, description]) => {
          const ValueIcon = Icon as typeof Layers3;
          return (
            <Card key={String(title)}>
              <ValueIcon size={22} />
              <h3>{String(title)}</h3>
              <p>{String(description)}</p>
            </Card>
          );
        })}
      </div>
      <a
        className="button primary"
        href={localePath(websiteConfig.auth.enabled ? '/auth/register' : '/ai')}
      >
        {m.pages_information_make_it_yours()}
        <ArrowUpRight size={16} />
      </a>
    </div>
  );
}
export function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <div className="container info-page">
      <SectionTitle
        eyebrow={m.pages_information_let_s_talk()}
        title={m.pages_information_good_conversations_start_here()}
        description={m.pages_information_have_a_question_or_a_useful_idea()}
      />
      <div className="contact-grid">
        <div>
          <h2>{m.pages_information_what_s_on_your_mind()}</h2>
          <p>{m.pages_information_for_account_questions_use_the_email_associated()}</p>
          <p className="fine-print">
            {m.pages_information_this_form_delivers_through_the_site_s()}
          </p>
        </div>
        <Card>
          {sent ? (
            <Notice kind="success">
              {m.pages_information_your_message_was_accepted_by_the_mail()}
            </Notice>
          ) : (
            <form
              className="stack"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const result = await api<{ accepted: boolean }>('/api/contact', {
                    method: 'POST',
                    body: JSON.stringify({ name, email, message }),
                  });
                  if (!result.accepted)
                    throw new Error(m.pages_information_the_mail_provider_did_not_accept_your());
                  setSent(true);
                  setMessage('');
                } catch (error) {
                  setError(errorMessage(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field
                label={m.pages_information_name()}
                autoComplete="name"
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Field
                label={m.pages_information_email()}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <label className="field">
                {m.pages_information_message()}
                <textarea
                  required
                  minLength={10}
                  maxLength={5000}
                  rows={7}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
              {error && <Notice kind="error">{error}</Notice>}
              <Button type="submit" busy={busy}>
                {m.pages_information_send_message()}
                <ArrowUpRight size={16} />
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
export function RoadmapPage() {
  return (
    <div className="container info-page">
      <SectionTitle
        eyebrow={m.pages_information_looking_ahead()}
        title={m.pages_information_a_little_direction_plenty_of_room()}
        description={m.pages_information_an_example_product_roadmap_to_make_your()}
      />
      <div className="roadmap-list">
        {[
          {
            title: m.pages_information_foundation(),
            status: m.pages_information_included(),
            items: [
              [
                m.pages_information_account_security(),
                m.pages_information_authentication_sessions_and_account_controls(),
              ],
              [
                m.pages_information_product_essentials(),
                m.pages_information_files_billing_api_keys_and_localized_content(),
              ],
            ],
          },
          {
            title: m.pages_information_before_launch(),
            status: m.pages_information_owner_checklist(),
            items: [
              [
                m.pages_information_connect_providers(),
                m.pages_information_configure_and_verify_the_services_your_product(),
              ],
              [
                m.pages_information_review_policies(),
                m.pages_information_replace_example_pricing_legal_pages_and_support(),
              ],
            ],
          },
          {
            title: m.pages_information_possibilities(),
            status: m.pages_information_ideas(),
            items: [
              [
                m.pages_information_your_unique_workflow(),
                m.pages_information_build_the_capability_that_makes_this_product(),
              ],
              [
                m.pages_information_learn_from_users(),
                m.pages_information_let_real_feedback_shape_what_comes_next(),
              ],
            ],
          },
        ].map((column) => (
          <section key={column.title}>
            <h2>
              {column.title} <span className="badge">{column.status}</span>
            </h2>
            {column.items.map(([title, description]) => (
              <div className="roadmap-item" key={title}>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
export function WaitlistPage() {
  return (
    <>
      <div className="container info-page">
        <SectionTitle
          eyebrow={m.pages_information_stay_in_the_loop()}
          title={m.pages_information_be_part_of_what_comes_next()}
          description={m.pages_information_join_product_updates_to_hear_about_new()}
        />
        <Notice>{m.pages_information_this_starter_uses_its_consent_based_newsletter()}</Notice>
      </div>
      <NewsletterCard />
    </>
  );
}
