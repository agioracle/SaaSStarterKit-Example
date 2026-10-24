import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const cli = process.env.EDGEKIT_LIGHTHOUSE_CLI;
if (!cli || !process.env.CHROME_PATH) throw Error('Set EDGEKIT_LIGHTHOUSE_CLI and CHROME_PATH to installed local audit/browser tools. No installation is performed.');
const directory = resolve(process.env.EDGEKIT_PERF_OUTPUT || 'evidence/lighthouse');
const method = process.env.EDGEKIT_LIGHTHOUSE_METHOD || 'simulate';
if (!['simulate', 'devtools'].includes(method)) throw Error('Use simulate or devtools throttling.');
const profiles = process.env.EDGEKIT_LIGHTHOUSE_PROFILES === 'mobile' ? ['mobile'] : ['desktop', 'mobile'];
mkdirSync(directory, { recursive: true });
const samples = [];
for (const profile of profiles) {
  for (const [locale, count] of [['en', 3], ['zh', 1]]) {
    for (let run = 1; run <= count; run++) {
      const output = resolve(directory, `${locale}-${profile}-${run}`);
      const url = `http://127.0.0.1:4173/${locale === 'zh' ? 'zh' : ''}`;
      const args = [cli, url, '--quiet', '--chrome-flags=--headless --no-first-run', `--throttling-method=${method}`, '--only-categories=performance,accessibility,best-practices,seo', '--output=json', '--output=html', `--output-path=${output}`];
      if (profile === 'desktop') args.push('--preset=desktop');
      const result = spawnSync(process.execPath, args, { stdio: 'inherit', shell: false, timeout: 90000 });
      if (result.error) throw result.error;
      if (result.status !== 0) throw Error(`Lighthouse failed: ${method} ${profile} ${locale} ${run}`);
      const report = JSON.parse(readFileSync(`${output}.report.json`, 'utf8'));
      if (report.runtimeError) throw Error(JSON.stringify(report.runtimeError));
      const metrics = Object.fromEntries(['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index', 'interactive'].map(id => [id, report.audits[id]?.numericValue ?? null]));
      const observed = report.audits.metrics?.details?.items?.[0] || {};
      const observedMetrics = Object.fromEntries(['observedFirstContentfulPaint', 'observedLargestContentfulPaint', 'observedLoad', 'observedDomContentLoaded', 'observedCumulativeLayoutShift'].map(id => [id, observed[id] ?? null]));
      samples.push({ method, profile, locale, run, lighthouseVersion: report.lighthouseVersion, fetchTime: report.fetchTime, environment: report.environment, configSettings: report.configSettings, finalDisplayedUrl: report.finalDisplayedUrl, scores: Object.fromEntries(Object.entries(report.categories).map(([key, value]) => [key, value.score])), metrics, observedMetrics, lcpBreakdown: report.audits['lcp-breakdown-insight']?.details, warnings: report.runWarnings });
      writeFileSync(resolve(directory, 'summary.json'), JSON.stringify(samples, null, 2));
      console.log(JSON.stringify({ method, profile, locale, run, scores: samples.at(-1).scores, metrics, observedMetrics }));
    }
  }
}
console.log(`Local Lighthouse ${method} measurements only. No field CWV or INP claim.`);
