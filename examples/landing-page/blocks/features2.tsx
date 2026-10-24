import { websiteConfig } from '@/config/website';
import { m } from '@/locale/paraglide/messages';
import { ArrowRight, ShieldCheck, CreditCard, Folder, Sparkles, Layers3 } from 'lucide-react';
import { localePath } from '@/locale';
export function Features2Section() {
  return (
    <section className="section container split-section">
      <div className="architecture-art">
        <div className="architecture-center">
          <Layers3 size={32} />
          <strong>{websiteConfig.name}</strong>
        </div>
        <div className="architecture-node node-one">
          <ShieldCheck size={20} />
          {m.blocks_features2_auth()}
        </div>
        <div className="architecture-node node-two">
          <Folder size={20} />
          {m.blocks_features2_r2_storage()}
        </div>
        <div className="architecture-node node-three">
          <CreditCard size={20} />
          {m.blocks_features2_payments()}
        </div>
        <div className="architecture-node node-four">
          <Sparkles size={20} />
          AI
        </div>
        <div className="architecture-orbit" />
      </div>
      <div>
        <span className="eyebrow">{m.blocks_features2_one_coherent_system()}</span>
        <h2>{m.blocks_features2_connected_by_design_not_held_together_by()}</h2>
        <p>{m.blocks_features2_authentication_storage_payments_and_ai_share_one()}</p>
        <a href={localePath('/about')} className="text-link">
          {m.blocks_features2_meet_the_foundation()}
          <ArrowRight size={17} />
        </a>
      </div>
    </section>
  );
}
export default Features2Section;
