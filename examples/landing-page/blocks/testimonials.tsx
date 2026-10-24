import { m } from '@/locale/paraglide/messages';

export function TestimonialsSection() {
  const samples = [
    {
      title: m.blocks_testimonials_an_independent_builder(),
      quote: m.blocks_testimonials_a_good_foundation_leaves_more_time_for(),
    },
    {
      title: m.blocks_testimonials_a_small_product_team(),
      quote: m.blocks_testimonials_clear_account_billing_and_security_flows_make(),
    },
    {
      title: m.blocks_testimonials_a_curious_experimenter(),
      quote: m.blocks_testimonials_the_most_useful_toolkit_makes_it_easier(),
    },
  ];
  return (
    <section className="section container audience-section">
      <div className="center-heading">
        <span className="eyebrow">{m.blocks_testimonials_a_space_for_customer_stories()}</span>
        <h2>{m.blocks_testimonials_make_room_for_real_voices()}</h2>
        <p>{m.blocks_testimonials_illustrative_quote_cards_replace_these_examples_with()}</p>
      </div>
      <div className="grid three">
        {samples.map((sample) => (
          <figure className="audience-card" key={sample.title}>
            <span className="badge">{m.blocks_testimonials_illustrative_example()}</span>
            <blockquote>
              <p>“{sample.quote}”</p>
            </blockquote>
            <figcaption>{sample.title}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
export default TestimonialsSection;
