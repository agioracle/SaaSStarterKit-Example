import { websiteConfig } from '@/config/website';
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  Folder,
  Sparkles,
  Layers3,
  Check,
} from 'lucide-react';
import { m } from '@/locale/paraglide/messages';
import { localePath } from '@/locale';
export function IllustratedHero() {
  return (
    <section className="hero container">
      <div className="hero-copy">
        <span className="eyebrow">
          <span className="tiny-dot" />
          {m.hero_eyebrow()}
        </span>
        <h1>{m.hero_title()}</h1>
        <p>{m.hero_description()}</p>
        <div className="row hero-actions">
          <a
            href={websiteConfig.auth.enabled ? localePath('/auth/register') : '#features'}
            className="button primary"
          >
            {m.hero_primary()}
            <ArrowUpRight size={17} />
          </a>
          <a href="#features" className="button secondary">
            {m.hero_secondary()}
            <ArrowRight size={17} />
          </a>
        </div>
        <div className="hero-note">
          <Check size={15} />
          {m.blocks_hero_independent_cloudflare_native_yours_to_make()}
        </div>
      </div>
      <div
        className="hero-visual"
        role="img"
        aria-label={m.blocks_hero_illustrative_workspace_preview()}
      >
        <div className="visual-grid" />
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="floating-label label-top">
          <span className="tiny-dot" />
          {m.blocks_hero_your_next_chapter()}
        </div>
        <div className="preview-window">
          <div className="preview-top">
            <span />
            <span />
            <span />
            <small>{m.blocks_hero_workspace_overview()}</small>
          </div>
          <div className="preview-content">
            <div className="preview-sidebar">
              <Layers3 size={20} />
              <i className="active" />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="preview-main">
              <span className="preview-eyebrow">{m.blocks_hero_good_things_ahead()}</span>
              <h2>{m.blocks_hero_a_place_for_your_next_idea()}</h2>
              <div className="preview-banner">
                <div>
                  <small>{m.blocks_hero_make_something()}</small>
                  <strong>{m.blocks_hero_extraordinary()}</strong>
                </div>
                <span>✳</span>
              </div>
              <div className="preview-tiles">
                {[ShieldCheck, Folder, Sparkles].map((Icon) => (
                  <div key={Icon.displayName}>
                    <Icon size={18} />
                    <i />
                    <small />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="floating-label label-bottom">
          <ShieldCheck size={17} />
          {m.blocks_hero_the_foundations_taken_care_of()}
        </div>
        <span className="hero-asterisk">✳</span>
        <span className="preview-caption">{m.blocks_hero_illustrative_workspace()}</span>
      </div>
    </section>
  );
}
export default IllustratedHero;
