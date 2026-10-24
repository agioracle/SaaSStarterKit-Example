import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { websiteConfig } from '../../config/website';
import { m } from '../../locale/paraglide/messages';
import { localePath } from '../../locale';

export function HeroSection() {
  return <section className="starter-hero container">
    <span className="eyebrow">{m.hero_eyebrow()}</span>
    <h1 className="starter-title">{m.hero_title()}</h1>
    <p className="starter-description">{m.hero_description()}</p>
    <div className="row hero-actions">
      <a href={websiteConfig.auth.enabled ? localePath('/auth/register') : '#features'} className="button primary">
        {m.hero_primary()}<ArrowUpRight size={17} />
      </a>
      <a href="#features" className="button secondary">{m.hero_secondary()}<ArrowRight size={17} /></a>
    </div>
  </section>;
}
export default HeroSection;
