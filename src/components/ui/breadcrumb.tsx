import type { ReactNode } from 'react';
export function Breadcrumb({
  children,
  label = 'Breadcrumb',
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <nav aria-label={label}>
      <ol className="ui-breadcrumb">{children}</ol>
    </nav>
  );
}
export function BreadcrumbItem({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}
export function BreadcrumbLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href}>{children}</a>;
}
export function BreadcrumbPage({ children }: { children: ReactNode }) {
  return <span aria-current="page">{children}</span>;
}
export function BreadcrumbSeparator() {
  return <li aria-hidden="true">/</li>;
}
