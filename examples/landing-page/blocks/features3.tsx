import { m } from '@/locale/paraglide/messages';
import { Check } from 'lucide-react';

export function Features3Section() {
  return (
    <section className="section container split-section reverse">
      <div>
        <span className="eyebrow">{m.blocks_features3_a_better_starting_point()}</span>
        <h2>{m.blocks_features3_from_blank_page_to_something_real()}</h2>
        <p>{m.blocks_features3_a_real_application_not_a_collection_of()}</p>
        <ul className="check-list">
          <li>
            <Check size={16} />
            {m.blocks_features3_server_rendered_pages()}
          </li>
          <li>
            <Check size={16} />
            {m.blocks_features3_protected_data_and_validated_requests()}
          </li>
          <li>
            <Check size={16} />
            {m.blocks_features3_no_simulated_payment_or_ai_success()}
          </li>
        </ul>
      </div>
      <div className="code-visual">
        <div>
          <span className="tiny-dot" /> {m.blocks_features3_foundation()}
        </div>
        <pre>
          <span className="code-muted">{'// less plumbing, more product'}</span>
          {'\n'}
          <span className="code-purple">const</span> nextIdea = {'{'}
          {'\n'} authentication: <span className="code-green">'connected'</span>,{'\n'} storage:{' '}
          <span className="code-green">'private'</span>,{'\n'} payments:{' '}
          <span className="code-green">'verified'</span>,{'\n'} possibilities:{' '}
          <span className="code-orange">Infinity</span>
          {'\n'}
          {'};'}
        </pre>
      </div>
    </section>
  );
}
export default Features3Section;
