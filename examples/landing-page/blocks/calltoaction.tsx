import { websiteConfig } from '@/config/website';
import { m } from '@/locale/paraglide/messages';
import { ArrowUpRight } from 'lucide-react';
import { localePath } from '@/locale';
export function CallToActionSection() {
  return (
    <section className="final-cta container">
      <span className="eyebrow">{m.blocks_calltoaction_the_next_chapter_is_yours()}</span>
      <h2>{m.blocks_calltoaction_what_will_you_make()}</h2>
      <a
        className="button primary"
        href={websiteConfig.auth.enabled ? localePath('/auth/register') : localePath('/about')}
      >
        {m.blocks_calltoaction_let_s_get_started()}
        <ArrowUpRight size={17} />
      </a>
      <span className="cta-star">✳</span>
    </section>
  );
}
export default CallToActionSection;
