import { readFile, writeFile } from 'node:fs/promises';
import { compile } from '@inlang/paraglide-js';
import { localeSettings, localeUrlPatterns } from '../src/config/locale-settings';
const command = process.argv[2] || 'compile';
if (command === 'sort') {
  for (const locale of localeSettings.locales) {
    const path = `messages/${locale}.json`;
    const values = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const sorted = Object.fromEntries(
      Object.keys(values)
        .sort()
        .map((key) => [key, values[key]]),
    );
    await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`);
  }
  console.log('Configured locale message keys sorted.');
} else if (command === 'compile') {
  await compile({
    project: './project.inlang',
    outdir: './src/locale/paraglide',
    strategy: ['url', 'baseLocale'],
    urlPatterns: localeUrlPatterns,
  });
  console.log(
    `Locale runtime compiled: ${localeSettings.baseLocale} unprefixed; other configured locales use their locale prefix.`,
  );
} else throw new Error('Usage: locale.ts compile|sort');
