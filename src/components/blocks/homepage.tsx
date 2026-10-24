import { websiteConfig } from '../../config/website';
import { HeroSection } from './hero';
import { FeaturesSection } from './features';
import { PricingSection } from './pricing';
import { FaqSection } from './faqs';
import { NewsletterCard } from './newsletter-card';

/** Production landing composition. Optional illustrative layouts live in examples/. */
export function HomePage() {
  return <>
    <HeroSection />
    <FeaturesSection />
    {websiteConfig.payment.enabled && <PricingSection />}
    <FaqSection />
    {websiteConfig.newsletter.enabled && <NewsletterCard />}
  </>;
}
export { HeroSection } from './hero';
export { FeaturesSection } from './features';
export { PricingSection } from './pricing';
export { FaqSection } from './faqs';
export { NewsletterCard } from './newsletter-card';
