import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { getMenuTitle, isMenuItemVisible, type MenuItemConfig } from '../../config/menu';
import { localePath } from '../../locale';
import { MenuIcon } from './menu-icon';
import './sidebar-navigation.css';

/** Presentation filtering only. Protected loaders and APIs remain the authorization boundary. */
export function visibleSidebarItems(items: readonly MenuItemConfig[], role?: string): MenuItemConfig[] {
  return items.flatMap((item) => {
    if (!isMenuItemVisible(item, role)) return [];
    const children = item.items ? visibleSidebarItems(item.items, role) : undefined;
    // Do not expose an empty group after filtering all of its protected children.
    if (!sidebarHref(item.href) && !children?.length) return [];
    return [{ ...item, ...(children ? { items: children } : {}) }];
  });
}

/** Only same-site paths, fragments, email, and explicit HTTP(S) destinations are navigable. */
export function sidebarHref(value?: string): string | undefined {
  if (!value || value !== value.trim() || (value.includes('\\') || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return localePath(value);
  if (value.startsWith('#')) return value;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!url.username && !url.password) return url.href;
    } catch { /* Invalid configuration is non-navigable, not an executable URL. */ }
  }
  return undefined;
}

function matchesPath(item: MenuItemConfig, pathname: string): boolean {
  const href = sidebarHref(item.href);
  return Boolean(href?.startsWith('/') && href.split(/[?#]/)[0] === localePath(pathname).split(/[?#]/)[0])
    || Boolean(item.items?.some((child) => matchesPath(child, pathname)));
}

export function SidebarNavigation({ items, role, pathname, label }: {
  items: readonly MenuItemConfig[];
  role?: string;
  pathname: string;
  label: string;
}) {
  return (
    <nav className="workspace-sidebar-navigation" aria-label={label}>
      {visibleSidebarItems(items, role).map((item) => (
        <SidebarEntry key={`${item.href || ""}:${item.title}`} item={item} pathname={pathname} />
      ))}
    </nav>
  );
}

function SidebarEntry({ item, pathname }: { item: MenuItemConfig; pathname: string }) {
  const href = sidebarHref(item.href);
  const content = <><MenuIcon icon={item.icon} /><span>{getMenuTitle(item.title)}{item.description && <small>{item.description}</small>}</span></>;
  const link = href ? (
    href.startsWith('/') && !item.external
      ? <Link to={item.href || '/dashboard'} className="sidebar-link" activeProps={{ className: 'active' }} activeOptions={{ exact: true }}>{content}</Link>
      : <a href={href} className="sidebar-link" target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}>{content}{item.external && <ArrowUpRight size={14} aria-hidden="true" />}</a>
  ) : null;
  if (!item.items?.length) return link;
  return (
    <details className="sidebar-group" open={matchesPath(item, pathname)}>
      <summary>{content}</summary>
      <div className="sidebar-group-items">
        {link}
        {item.items.map((child) => <SidebarEntry key={`${child.href || ""}:${child.title}`} item={child} pathname={pathname} />)}
      </div>
    </details>
  );
}
