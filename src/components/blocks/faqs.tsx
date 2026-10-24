import { m } from '../../locale/paraglide/messages';
import { ArrowRight } from 'lucide-react';
import { localePath } from '../../locale';
export function FaqSection() {
  const questions = [
    {
      question: m.blocks_faqs_can_i_try_this_without_paying(),
      answer: m.blocks_faqs_yes_create_an_account_to_explore_the(),
    },
    {
      question: m.blocks_faqs_is_my_data_private(),
      answer: m.blocks_faqs_account_resources_are_protected_by_server_side(),
    },
    {
      question: m.blocks_faqs_which_payment_services_are_supported(),
      answer: m.blocks_faqs_the_starter_includes_stripe_creem_and_waffo(),
    },
    {
      question: m.blocks_faqs_what_happens_if_a_service_is_not(),
      answer: m.blocks_faqs_you_ll_see_an_explicit_unavailable_or(),
    },
    {
      question: m.blocks_faqs_can_i_change_or_cancel_a_subscription(),
      answer: m.blocks_faqs_use_the_billing_portal_to_manage_your(),
    },
  ];
  return (
    <section className="section container faq-section">
      <div>
        <span className="eyebrow">{m.blocks_faqs_a_few_good_questions()}</span>
        <h2>{m.blocks_faqs_wondering_about_the_details()}</h2>
        <a className="text-link" href={localePath('/contact')}>
          {m.blocks_faqs_let_s_talk()}
          <ArrowRight size={16} />
        </a>
      </div>
      <div className="faq-list">
        {questions.map(({ question, answer }) => (
          <details key={question}>
            <summary>
              {question}
              <span>+</span>
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
export default FaqSection;
