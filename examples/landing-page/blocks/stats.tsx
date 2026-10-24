import { locales } from '@/locale';
import { m } from '@/locale/paraglide/messages';

export function StatsSection() {
  return (
    <section className="stats container">
      <div>
        <strong>10</strong>
        <span>{m.blocks_stats_ai_tools_to_explore()}</span>
      </div>
      <div>
        <strong>3</strong>
        <span>{m.blocks_stats_payment_provider_adapters()}</span>
      </div>
      <div>
        <strong>{locales.length}</strong>
        <span>{m.blocks_stats_languages_one_experience()}</span>
      </div>
      <div>
        <strong>1</strong>
        <span>{m.blocks_stats_connected_foundation()}</span>
      </div>
    </section>
  );
}
export default StatsSection;
