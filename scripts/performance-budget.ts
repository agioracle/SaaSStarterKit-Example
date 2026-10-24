import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Build diagnostics, not CWV, actual transferred bytes, or execution-time metrics. */
export const PERFORMANCE_BUDGET = {
  homepageJsRaw: 570_000,
  homepageJsGzip9: 190_000,
  entryJsRaw: 355_000,
  entryJsGzip9: 115_000,
  scaledClientGrowthRaw: 4_096,
};
export function htmlAssetPaths(html: string) {
  const tags = [...html.matchAll(/<(?:link|script)\b[^>]*>/g)].map(([tag]) => tag);
  return [...new Set(tags.flatMap((tag) => {
    if (tag.startsWith('<link') && !/rel="modulepreload"/.test(tag)) return [];
    const path = tag.match(/(?:href|src)="(\/assets\/[^"?#]+\.js)"/)?.[1];
    return path ? [path] : [];
  }))];
}
export async function bundleDiagnostics(root: string, html: string) {
  const assetDir = join(root, 'dist/client/assets');
  const filenames = await readdir(assetDir);
  // public/assets must never be used: only Vite's fingerprinted outputs inherit immutable.
  for (const file of filenames) {
    if (!/-[A-Za-z0-9_-]{8,}\.[a-z0-9]+(?:\.map)?$/.test(file))
      throw new Error(`Nonfingerprinted asset cannot receive immutable caching: ${file}`);
  }
  async function size(path: string) {
    const bytes = await readFile(join(root, 'dist/client', path));
    return { path, raw: bytes.length, gzip9: gzipSync(bytes, { level: 9 }).length };
  }
  const homepage = await Promise.all(htmlAssetPaths(html).map(size));
  const client = await Promise.all(filenames.filter((name) => name.endsWith('.js')).map((name) => size(`/assets/${name}`)));
  const entry = homepage.find(({ path }) => /^index-[\w-]+\.js$/.test(basename(path)));
  if (!entry || !homepage.length) throw new Error('Missing homepage entry declarations');
  return {
    metric: 'Built file sizes and SSR-declared JS URLs. Not browser downloads or Core Web Vitals.',
    homepage,
    homepageTotals: homepage.reduce((sum, file) => ({ raw: sum.raw + file.raw, gzip9: sum.gzip9 + file.gzip9 }), { raw: 0, gzip9: 0 }),
    entry,
    clientTotals: client.reduce((sum, file) => ({ raw: sum.raw + file.raw, gzip9: sum.gzip9 + file.gzip9 }), { raw: 0, gzip9: 0 }),
    client,
  };
}
export function assertBundleBudget(result: Awaited<ReturnType<typeof bundleDiagnostics>>) {
  for (const [value, limit, name] of [
    [result.homepageTotals.raw, PERFORMANCE_BUDGET.homepageJsRaw, 'homepage raw'],
    [result.homepageTotals.gzip9, PERFORMANCE_BUDGET.homepageJsGzip9, 'homepage gzip9'],
    [result.entry.raw, PERFORMANCE_BUDGET.entryJsRaw, 'entry raw'],
    [result.entry.gzip9, PERFORMANCE_BUDGET.entryJsGzip9, 'entry gzip9'],
  ] as const) if (value > limit) throw new Error(`${name}: ${value} exceeds ${limit}`);
}
