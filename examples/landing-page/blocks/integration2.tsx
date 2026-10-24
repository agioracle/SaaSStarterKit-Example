import { m } from '@/locale/paraglide/messages';
import { Zap } from 'lucide-react';

export function Integration2Section() {
  return (
    <section className="edge-note container">
      <Zap size={24} />
      <div>
        <strong>{m.blocks_integration2_built_for_the_edge_not_around_it()}</strong>
        <p>{m.blocks_integration2_workers_for_compute_d1_for_data_r2()}</p>
      </div>
    </section>
  );
}
export default Integration2Section;
