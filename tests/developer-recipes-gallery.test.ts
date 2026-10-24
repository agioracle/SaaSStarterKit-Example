import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/locale', () => ({ getLocale: () => 'en', localePath: (path: string) => path }));
import { ComponentGallery } from '../src/components/developer/gallery';

describe('development component gallery', () => {
  it('renders actual accessible form, dialog trigger, switch and selection controls', () => {
    const html = renderToString(createElement(ComponentGallery));
    expect(html).toContain('Component workbench');
    expect(html).toContain('Open dialog');
    expect(html).toContain('Project name');
    expect(html).toContain('role="switch"');
    expect(html).toContain('Display density');
    expect(html).toContain('role="tablist"');
  });
  it('keeps imports behind a production-excluded branch and denies the route before rendering', () => {
    const route = readFileSync('src/routes/developer.components.tsx', 'utf8');
    expect(route).toContain('if (!import.meta.env.DEV) throw notFound()');
    expect(route).toContain('component: import.meta.env.DEV');
    expect(route).toContain('noIndex: true');
    expect(route).not.toMatch(/^import.*gallery/m);
  });
});
