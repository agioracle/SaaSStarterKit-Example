import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { localeSettings } from '../src/config/locale-settings';

const catalogs = Object.fromEntries(
  localeSettings.locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8')) as Record<string, unknown>,
  ]),
);
const base = catalogs[localeSettings.baseLocale];
if (!base) throw new Error('baseLocale must be included in the configured locales.');
const keys = Object.keys(base);
const errors: string[] = [];
const placeholders = (value: unknown) =>
  typeof value === 'string'
    ? [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    : [];
for (const [locale, catalog] of Object.entries(catalogs)) {
  for (const key of keys) {
    if (!(key in catalog)) errors.push(`${locale}: missing ${key}`);
    else if (typeof catalog[key] !== 'string' || !catalog[key])
      errors.push(`${locale}: empty/invalid ${key}`);
    else if (JSON.stringify(placeholders(catalog[key])) !== JSON.stringify(placeholders(base[key])))
      errors.push(`${locale}: mismatched placeholders in ${key}`);
  }
  for (const key of Object.keys(catalog))
    if (!(key in base)) errors.push(`${locale}: extra ${key}`);
}
function inspect(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'paraglide') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) inspect(path);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.server.ts')) {
      const source = readFileSync(path, 'utf8');
      if (/\bt\(\s*['"`]/.test(source))
        errors.push(`${path}: inline bilingual t() messages are not allowed; use the catalog.`);
    }
  }
}
inspect('src');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Locale parity verified: ${keys.length} keys across ${localeSettings.locales.join(', ')}. Inline bilingual UI messages: 0. This is not a guarantee that custom/provider content is translated.`,
  );
