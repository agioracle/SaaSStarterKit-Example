import { cpSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
/** Explicit test content only. Never seed the operator's production content directory. */
export function seedBrowserContent(source: string, target: string) {
  if (resolve(source) === resolve(target)) throw Error('Content fixtures require a separate checkout.');
  const fixtures = resolve(source, 'tests/fixtures/blog');
  if (!existsSync(fixtures)) throw Error('Missing browser Markdown fixtures.');
  cpSync(fixtures, resolve(target, 'content/blog'), { recursive: true, filter: path => basename(path) !== 'README.md' });
}
