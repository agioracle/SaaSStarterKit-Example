import { m } from '../../locale/paraglide/messages';
import { ShieldCheck, CreditCard, Folder, Sparkles, Globe2, KeyRound } from 'lucide-react';

function getFeatures() {
  return [
    {
      icon: ShieldCheck,
      title: m.blocks_features_a_warm_welcome(),
      description: m.blocks_features_email_and_google_sign_in_verified_accounts(),
    },
    {
      icon: CreditCard,
      title: m.blocks_features_a_way_to_grow(),
      description: m.blocks_features_subscriptions_one_time_payments_and_a_secure(),
    },
    {
      icon: Folder,
      title: m.blocks_features_everything_in_its_place(),
      description: m.blocks_features_private_file_storage_validated_uploads_and_ownership(),
    },
    {
      icon: Sparkles,
      title: m.blocks_features_room_for_imagination(),
      description: m.blocks_features_practical_ai_tools_for_text_images_audio(),
    },
    {
      icon: Globe2,
      title: m.blocks_features_a_wider_world(),
      description: m.blocks_features_english_and_chinese_routes_translated_content_and(),
    },
    {
      icon: KeyRound,
      title: m.blocks_features_yours_to_connect(),
      description: m.blocks_features_named_api_keys_clear_account_controls_and(),
    },
  ];
}
export function FeaturesSection() {
  return (
    <section className="section container" id="features">
      <div className="section-intro">
        <div>
          <span className="eyebrow">{m.blocks_features_less_rebuilding_more_making()}</span>
          <h2>{m.blocks_features_the_essentials_thoughtfully_connected()}</h2>
        </div>
        <p>{m.blocks_features_small_details_add_up_to_a_better()}</p>
      </div>
      <div className="feature-grid">
        {getFeatures().map((item) => (
          <article key={item.title} className="feature-card">
            <div className="feature-icon">
              <item.icon size={22} />
            </div>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
export default FeaturesSection;
