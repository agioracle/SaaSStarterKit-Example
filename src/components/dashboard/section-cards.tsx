import { Mail, ShieldCheck, UserRound } from 'lucide-react';
import type { ElementType, ReactNode } from 'react';
import { m } from '../../locale/paraglide/messages';
import { Card } from '../ui/core';
import { MenuIcon } from '../layout/menu-icon';

export interface SectionCardData {
  id: string;
  title: string;
  value: ReactNode;
  description?: string;
  icon?: ElementType;
}

/** Reusable summary cards. Values belong to the caller; this component invents no metrics. */
export function SectionCards({ cards, label }: { cards: readonly SectionCardData[]; label: string }) {
  return (
    <section aria-label={label} className="grid three dashboard-section-cards">
      {cards.map(({ id, title, value, description, icon }) => (
        <Card key={id} title={title}>
          <MenuIcon icon={icon} />
          <p className="summary-card-value" style={{ overflowWrap: 'anywhere' }}>{value}</p>
          {description && <p className="muted">{description}</p>}
        </Card>
      ))}
    </section>
  );
}

/** The default dashboard uses the authenticated session, not fictitious revenue or usage. */
export function AccountSectionCards({ user }: {
  user: { email: string; emailVerified: boolean; role?: string | null };
}) {
  return <SectionCards label={m.routes_app_dashboard_account_at_a_glance()} cards={[
    { id: 'email', title: m.routes_app_dashboard_email(), value: user.email, icon: Mail },
    {
      id: 'verification', title: m.routes_app_dashboard_status(), icon: ShieldCheck,
      value: user.emailVerified ? m.routes_app_dashboard_verified() : m.routes_app_dashboard_awaiting_verification(),
    },
    { id: 'role', title: m.routes_app_dashboard_role(), value: user.role || 'user', icon: UserRound },
  ]} />;
}
