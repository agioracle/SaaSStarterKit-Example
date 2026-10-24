import { seedBrowserContent } from './local/content-fixtures';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile, stat, lstat } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleDiagnostics, assertBundleBudget, PERFORMANCE_BUDGET } from './performance-budget';

const project = fileURLToPath(new URL('..', import.meta.url));
// Never build the developer's active checkout or share runtime persistence.
const output = await mkdtemp(join(dirname(project), 'performance-remediation-checks-'));
const root = join(output, 'source');
const home = join(output, 'home');
await mkdir(home, { recursive: true });
const excluded = new Set(['node_modules', 'dist', '.git', '.wrangler', '.saas', '.content-collections', 'test-results', 'playwright-report', 'paraglide', '.local-smoke', '.tanstack', '.output', '.react-email', 'coverage', '.agents', '.codex']);
await cp(project, root, {
  recursive: true,
  filter: async (path) => !excluded.has(basename(path)) && !/^\.(?:env|dev\.vars)(?:\.|$)/.test(basename(path)) && !(await lstat(path)).isSymbolicLink(),
});
try { await stat(join(project, 'public/assets')); throw new Error('public/assets is reserved for fingerprinted Vite output'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
await mkdir(join(root, 'node_modules'));
for (const name of await readdir(join(project, 'node_modules'))) {
  if (['.vite', '.vite-temp', '.cache'].includes(name)) continue;
  await symlink(join(project, 'node_modules', name), join(root, 'node_modules', name), 'dir');
}
const env = {
  PATH: process.env.PATH,
  HOME: home,
  XDG_CONFIG_HOME: home,
  CI: 'true',
  CLOUDFLARE_SEND_METRICS: 'false',
  WRANGLER_LOG_PATH: join(output, 'wrangler.log'),
};
console.log(`Isolated build diagnostics: ${output}`);
async function build(label: string) {
  const child = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (part) => { logs += part; });
  child.stderr.on('data', (part) => { logs += part; });
  const result = await new Promise<{ code: number | null; signal: string | null }>((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => done({ code, signal }));
  });
  await writeFile(join(output, `${label}-build.log`), logs);
  if (result.code !== 0) throw new Error(`${label} build failed (status ${result.code}, signal ${result.signal}). See ${output}/${label}-build.log`);
}
async function assertClientContentAbsent(markers: string[]) {
  const files = await readdir(join(root, 'dist/client/assets'));
  for (const file of files.filter((file) => /\.(?:js|map)$/.test(file))) {
    const text = await readFile(join(root, 'dist/client/assets', file), 'utf8');
    for (const marker of markers) if (text.includes(marker)) throw new Error(`Content leaked into ${file}: ${marker.slice(0, 80)}`);
  }
}
async function probe(label: string, port: number) {
  const state = join(output, `${label}-state`);
  await mkdir(state, { recursive: true });
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--config', 'dist/server/wrangler.json', '--port', String(port), '--ip', '127.0.0.1', '--inspector-port', String(port + 5000), '--persist-to', state,
    '--var', 'APP_ENV:test', '--var', `APP_URL:${base}`, '--var', 'BETTER_AUTH_SECRET:performance-fixture-only-not-a-production-secret-12345'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (part) => { logs += part; });
  child.stderr.on('data', (part) => { logs += part; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch { /* startup */ }
      if (child.exitCode !== null) throw new Error(`Worker exited: ${logs}`);
      await new Promise((done) => setTimeout(done, 500));
    }
    if (!ready) throw new Error(`Worker startup timed out: ${logs}`);
    const homeResponse = await fetch(base);
    const html = await homeResponse.text();
    if (homeResponse.status !== 200) throw new Error(`Home returned ${homeResponse.status}`);
    if (homeResponse.headers.get('cache-control') !== 'no-store') throw new Error('Public SSR must explicitly disable shared caching');
    await writeFile(join(output, `${label}-homepage.html`), html);
    const diagnostics = await bundleDiagnostics(root, html);
    assertBundleBudget(diagnostics);
    for (const file of diagnostics.homepage) {
      if (/\/(?:markdown|shell-menus|information)-/.test(file.path))
        throw new Error(`Optional content/menu renderer in homepage declarations: ${file.path}`);
    }
    const routes = [];
    for (const start of ['/blog', '/zh/blog', '/blog?page=1&category=', '/blog?page=2', '/zh/blog?page=2', '/blog?category=Product', '/blog?page=99999', '/blog?category=not-real']) {
      let url = start;
      const hops = [];
      for (let hop = 0; hop < 4; hop++) {
        const response = await fetch(base + url, { redirect: 'manual' });
        const html = await response.text();
        hops.push({ url, status: response.status, location: response.headers.get('location'), canonical: html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] });
        if (response.status === 200) break;
        const next = response.headers.get('location');
        if (!next) break;
        const parsed = new URL(next, base);
        if (parsed.origin !== base) throw new Error('Unexpected external redirect');
        url = parsed.pathname + parsed.search;
      }
      const expectedMax = start.includes('99999') || start.includes('not-real') ? 2 : 1;
      if (hops.at(-1)?.status !== 200 || hops.length > expectedMax) throw new Error(`Unexpected blog URL chain: ${JSON.stringify(hops)}`);
      routes.push({ start, hops });
    }
    for (const route of ['/pricing', '/zh/pricing', '/privacy', '/zh/privacy', '/terms', '/zh/terms', '/cookie', '/zh/cookie', '/changelog', '/zh/changelog', '/blog/a-thoughtful-foundation', '/zh/blog/a-thoughtful-foundation']) {
      const response = await fetch(base + route, { redirect: 'manual' });
      const html = await response.text();
      if (response.status !== 200 || (html.match(/<h1[\s>]/g) || []).length !== 1) throw new Error(`Public route/H1 failure: ${route}: ${response.status}`);
      if (!html.includes(`lang="${route.startsWith('/zh') ? 'zh' : 'en'}"`)) throw new Error(`Locale mismatch: ${route}`);
    }
    for (const route of ['/blog/missing-performance-fixture', '/blog/performance-draft']) {
      if ((await fetch(base + route)).status !== 404) throw new Error(`Missing/draft article exposed: ${route}`);
    }
    const assets = [];
    for (const file of diagnostics.homepage) {
      const response = await fetch(base + file.path);
      const cache = response.headers.get('cache-control');
      if (!response.ok || cache !== 'public, max-age=31536000, immutable') throw new Error(`Fingerprinted asset cache mismatch: ${file.path}: ${cache}`);
      assets.push({ path: file.path, cache });
    }
    const raster = await fetch(`${base}/og.png`);
    if (!raster.ok || !raster.headers.get('content-type')?.includes('image/png') || raster.headers.get('cache-control')?.includes('immutable')) throw new Error('Raster OG format/cache mismatch');
    const concurrentLocales = await Promise.all(Array.from({ length: 40 }, async (_, i) => {
      const locale = i % 2 ? 'zh' : 'en';
      const text = await (await fetch(base + (locale === 'zh' ? '/zh/about' : '/about'))).text();
      return text.includes(`lang="${locale}"`) && text.includes(locale === 'zh' ? '少一些重复建设' : 'Less plumbing');
    }));
    if (concurrentLocales.some((ok) => !ok)) throw new Error('Concurrent locale isolation failed');
    return { ...diagnostics, routes, assets, localeChecks: concurrentLocales.length };
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((done) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); done(); });
      if (child.exitCode !== null) { clearTimeout(timer); done(); }
    });
    await writeFile(join(output, `${label}-worker.log`), logs);
  }
}
seedBrowserContent(project, root);
await build('baseline');
const baseline = await probe('baseline', 4197);
const bodies: string[] = [];
for (const name of ['allBlogs', 'allPages', 'allChangelogs']) {
  const module = await import(pathToFileURL(join(root, `.content-collections/generated/${name}.js`)).href);
  for (const doc of module.default) {
    const paragraph = doc.content.trim().split('\n').find((line: string) => line.length > 20 && !line.startsWith('#'));
    if (!paragraph) throw new Error(`No usable body sentinel for ${name}/${doc.slug}/${doc.locale}`);
    bodies.push(paragraph);
  }
}
await assertClientContentAbsent(bodies);
const marker = 'PERFORMANCE_BODY_SCALE_2c7239_';
const syntheticParagraph = 'Synthetic published body content at scale. '.repeat(512);
let addedBodyBytes = 0;
const title = 'PERFORMANCE_TITLE_SCALE_2c7239_';
const draft = 'PERFORMANCE_UNPUBLISHED_2c7239_';
for (let i = 0; i < 128; i++) {
  addedBodyBytes += Buffer.byteLength(`${marker}${i}\n${syntheticParagraph}\n`);
  await writeFile(join(root, `content/blog/performance-scale-${i}.md`), `---\ntitle: ${title}${i}\ndescription: Synthetic content scale test\ndate: "2020-01-01"\ncategory: Product\nimage: /og.png\npublished: true\n---\n\n${marker}${i}\n${syntheticParagraph}\n`);
}
await writeFile(join(root, 'content/blog/performance-draft.md'), `---\ntitle: ${draft}\ndescription: Unpublished test\ndate: "2020-01-01"\ncategory: Product\nimage: /og.png\npublished: false\n---\n${draft}\n`);
await build('scaled');
const scaled = await probe('scaled', 4197);
await assertClientContentAbsent([...bodies, marker, title, draft]);
const generated = await readFile(join(root, '.content-collections/generated/allBlogs.js'), 'utf8');
if (!generated.includes(marker) || generated.includes(draft)) throw new Error('Synthetic positive control/draft filter failed');
const growth = scaled.clientTotals.raw - baseline.clientTotals.raw;
if (growth > PERFORMANCE_BUDGET.scaledClientGrowthRaw) throw new Error(`Content scale increased client JS ${growth} bytes`);
const report = { baseline, scaled, additionalPublishedArticles: 128, additionalBodyBytes: addedBodyBytes, bodySentinelsAbsent: bodies.length, clientGrowthRaw: growth, budgets: PERFORMANCE_BUDGET, browserTested: false };
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, homepage: baseline.homepageTotals, entry: baseline.entry, clientGrowthRaw: growth, bodySentinelsAbsent: bodies.length, extraArticles: 128, browserTested: false }, null, 2));
