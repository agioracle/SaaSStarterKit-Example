import { m } from '../../locale/paraglide/messages';
import type { HTMLAttributes, ReactNode } from 'react';
export function Sidebar({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <aside {...props} className={`sidebar ${className}`} />;
}
export function SidebarContent({ children }: { children: ReactNode }) {
  return <nav aria-label={m.routes_app_dashboard_your_workspace()}>{children}</nav>;
}
export function SidebarFooter({ children }: { children: ReactNode }) {
  return <div className="sidebar-bottom">{children}</div>;
}
