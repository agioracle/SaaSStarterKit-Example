import { m } from '@/locale/paraglide/messages';

export function IntegrationSection() {
  return (
    <section className="section container">
      <div className="center-heading">
        <span className="eyebrow">{m.blocks_integration_good_company()}</span>
        <h2>{m.blocks_integration_your_tools_working_together()}</h2>
        <p>{m.blocks_integration_choose_the_services_that_fit_configure_credentials()}</p>
      </div>
      <div className="integration-grid">
        {[
          'Stripe',
          'Creem',
          'Waffo',
          'Resend',
          'Cloudflare R2',
          'fal.ai',
          'Google OAuth',
          'Cloudflare D1',
        ].map((name, index) => (
          <div key={name}>
            <span className={`integration-symbol symbol-${index % 4}`}>{name.slice(0, 1)}</span>
            {name}
          </div>
        ))}
      </div>
    </section>
  );
}
export default IntegrationSection;
