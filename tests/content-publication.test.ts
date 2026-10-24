import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuilder } from '@content-collections/core';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

const project = fileURLToPath(new URL('..', import.meta.url));
const fixtures: string[] = [];
const privateMarker = 'UNPUBLISHED_CONTENT_SENTINEL_70c5a1e4';
const publicBody = 'PUBLISHED_BODY_SENTINEL_ba49d6d1';

async function put(root: string, path: string, contents: string) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

function markdown(kind: 'blog' | 'changelog' | 'page', title: string, body: string, published?: boolean) {
  return [
    '---',
    `title: ${title}`,
    'description: Publication boundary regression fixture.',
    'date: "2026-10-24"',
    ...(kind === 'blog' ? ['category: Engineering', 'image: /og.svg'] : []),
    ...(kind === 'changelog' ? ['version: "0.1.0"'] : []),
    ...(published === undefined ? [] : [`published: ${published}`]),
    '---',
    body,
  ].join('\n');
}

async function fixture() {
  // Keep every fixture and output isolated from real content and production dist.
  const parent = join(project, '.content-collections');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'publication-fixture-'));
  fixtures.push(root);
  for (const path of [
    'content-collections.ts',
    'src',
    'project.inlang/settings.json',
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await cp(join(project, path), join(root, path), { recursive: true });
  }
  await put(root, 'package.json', '{"name":"publication-fixture","type":"module","private":true}');
  for (const locale of ['', '.zh']) {
    for (const kind of ['blog', 'changelog'] as const) {
      // Cover both the default published value and explicit true, plus both locales.
      await put(root, `content/${kind}/public${locale}.md`, markdown(kind, `Public ${kind}`, `${publicBody}_${kind}_${locale ? 'zh' : 'en'}`, locale ? true : undefined));
      await put(root, `content/${kind}/draft${locale}.md`, markdown(kind, `${privateMarker}_${kind}_TITLE`, `${privateMarker}_${kind}_BODY`, false));
    }
    await put(root, `content/pages/privacy${locale}.md`, markdown('page', 'Privacy fixture', 'Published policy body.'));
    await put(root, `content/pages/draft${locale}.md`, markdown('page', `${privateMarker}_page_TITLE`, `${privateMarker}_page_BODY`, false));
  }
  const builder = await createBuilder(join(root, 'content-collections.ts'));
  builder.on('_error', ({ error }) => { throw error; });
  await builder.build();
  return { root, builder };
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }))).flat();
}

async function assertAbsent(directory: string, forbidden: string[]) {
  const files = await filesBelow(directory);
  expect(files.length).toBeGreaterThan(0);
  for (const path of files) {
    const content = await readFile(path, 'utf8');
    for (const marker of forbidden) {
      expect(content, `Unexpected content ${marker} in ${path}`).not.toContain(marker);
    }
  }
  return files;
}

async function collection(root: string, name: string) {
  // Content Collections serializes these JSON-only schemas into default exports.
  const generated = await readFile(join(root, '.content-collections/generated', `${name}.js`), 'utf8');
  return JSON.parse(generated.trim().replace(/^export default /, '').replace(/;$/, '')) as Array<Record<string, unknown>>;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('content publication boundary', () => {
  it('excludes unpublished Markdown before generation, including translated drafts and metadata', async () => {
    const { root } = await fixture();
    for (const name of ['allBlogs', 'allBlogSummaries', 'allChangelogs', 'allPages']) {
      const documents = await collection(root, name);
      expect(documents).toHaveLength(2);
      expect(documents.map((document) => document.locale).sort()).toEqual(['en', 'zh']);
      expect(documents.every((document) => document.published === true)).toBe(true);
      expect(documents.every((document) => document.slug === (name === 'allPages' ? 'privacy' : 'public'))).toBe(true);
    }
    expect(await collection(root, 'allPages')).toHaveLength(2);
    expect((await collection(root, 'allBlogSummaries')).every((summary) => !('content' in summary))).toBe(true);
    // Check caches too: transform code does not persist raw draft bodies there.
    await assertAbsent(join(root, '.content-collections'), [privateMarker, 'draft.md', 'draft.zh.md']);
  });

  it('removes formerly public content from generated output on an incremental unpublish', async () => {
    const { root, builder } = await fixture();
    for (const kind of ['blog', 'changelog', 'page'] as const) {
      const path = kind === 'page' ? 'content/pages/privacy.md' : `content/${kind}/public.md`;
      await put(root, path, markdown(kind, 'Now unpublished', `${publicBody}_${kind}`, false));
      expect(await builder.sync('update', join(root, path))).toBe(true);
    }
    for (const name of ['allBlogs', 'allBlogSummaries', 'allChangelogs', 'allPages']) {
      const documents = await collection(root, name);
      expect(documents).toHaveLength(1);
      expect(documents[0].locale).toBe('zh');
    }
    await assertAbsent(join(root, '.content-collections'), [
      privateMarker,
      'Now unpublished',
      `${publicBody}_blog_en`,
      `${publicBody}_changelog_en`,
    ]);
  });

  it('keeps drafts out of production client/server artifacts and all article bodies out of listing bundles', async () => {
    const { root } = await fixture();
    await put(root, 'content-entry.ts', [
      "export { getSortedPosts, getPaginatedPosts, getPostBySlug, getPostLocales } from './src/lib/blog';",
      "export { getPaginatedPosts as getPaginatedSummaries } from './src/lib/blog-catalog';",
      "export { allChangelogs, allPages } from './.content-collections/generated';",
      "export { BlogArticle, BlogListing } from './src/components/blog/blog';",
    ].join('\n'));
    // Internal listing queries stay metadata-only; the public blog helper contract
    // returns full bodies and is deliberately server-only.
    await put(root, 'listing-entry.ts', [
      "export { getSortedPosts, getPaginatedPosts, getPostLocales } from './src/lib/blog-catalog';",
      "export { BlogListing } from './src/components/blog/blog';",
    ].join('\n'));
    for (const target of ['client', 'server', 'listing-client'] as const) {
      const entry = join(root, target === 'listing-client' ? 'listing-entry.ts' : 'content-entry.ts');
      await build({
        root,
        configFile: false,
        envFile: false,
        publicDir: false,
        logLevel: 'silent',
        mode: 'production',
        build: {
          outDir: join(root, 'dist', target),
          emptyOutDir: true,
          sourcemap: true,
          minify: true,
          rolldownOptions: { output: { entryFileNames: 'content.mjs' } },
          ...(target === 'server' ? { ssr: entry } : {}),
          lib: { entry, formats: ['es'], fileName: () => 'content.mjs' },
        },
      });
    }
    const artifacts = await assertAbsent(join(root, 'dist'), [privateMarker, 'draft.md', 'draft.zh.md']);
    expect(artifacts.some((path) => path.endsWith('.map'))).toBe(true);
    await assertAbsent(join(root, 'dist/listing-client'), [publicBody, 'Published policy body.']);
    // Positive control: the full public article remains usable; filtering is not
    // an accidental empty build. Exercise the real bundled lookup and payload data.
    const execution = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const content = await import('./dist/server/content.mjs');
      const { createElement } = await import('react');
      const { renderToStaticMarkup } = await import('react-dom/server');
      const article = content.getPostBySlug('public', 'en');
      console.log(JSON.stringify({
        article,
        articleHtml: renderToStaticMarkup(createElement(content.BlogArticle, { post: article })),
        listingHtml: renderToStaticMarkup(createElement(content.BlogListing, { ...content.getPaginatedSummaries(1, 'en'), page: 1, category: '', categories: ['Engineering'] })),
        draft: content.getPostBySlug('draft', 'en') ?? null,
        draftLocales: content.getPostLocales('draft'),
        list: content.getPaginatedPosts(1, 'en'),
        summaryList: content.getPaginatedSummaries(1, 'en'),
        changelog: content.allChangelogs,
      }));
    `], { cwd: root, encoding: 'utf8', timeout: 15_000 });
    expect(execution.status, execution.stderr).toBe(0);
    expect(execution.stdout).not.toContain(privateMarker);
    const payload = JSON.parse(execution.stdout);
    expect(payload.article.content).toContain(publicBody);
    expect(payload.articleHtml).toContain(publicBody);
    expect(payload.listingHtml).toContain('Public blog');
    expect(payload.listingHtml).not.toContain(publicBody);
    expect(payload.draft).toBeNull();
    expect(payload.draftLocales).toEqual([]);
    expect(payload.list.posts).toHaveLength(1);
    expect(payload.list.posts[0].content).toContain(publicBody);
    expect(payload.summaryList.posts[0]).not.toHaveProperty('content');
    expect(payload.changelog).toHaveLength(2);
  }, 60_000);
});
