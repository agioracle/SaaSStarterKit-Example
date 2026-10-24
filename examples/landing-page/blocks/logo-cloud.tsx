import { m } from '@/locale/paraglide/messages';

export function LogoCloudSection() {
  return (
    <section className="logo-cloud container">
      <span>{m.blocks_logo_cloud_built_on_foundations_you_know()}</span>
      <div>
        {['Cloudflare', 'TanStack', 'React', 'Better Auth', 'Drizzle'].map((name) => (
          <strong key={name}>{name}</strong>
        ))}
      </div>
    </section>
  );
}
export default LogoCloudSection;
