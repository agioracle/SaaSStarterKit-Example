#!/usr/bin/env node
/** Offline-only opt-in installer. It never launches a process, contacts a provider, or migrates D1. */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const root = fileURLToPath(new URL('./files/', import.meta.url));
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Recipe files must not contain symlinks.');
    return entry.isDirectory() ? walk(path) : [path];
  });
}
function assertNoSymlink(path) {
  for (let current = path; current !== dirname(current); current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error(`Symlink target refused: ${current}`);
  }
}
export function applyPrivateNotes({ target = process.cwd(), execute = false, confirm = '', log = console.log } = {}) {
  const destination = resolve(target);
  assertNoSymlink(destination);
  if (!existsSync(destination) || realpathSync(destination) !== destination) throw Error('Target must be an existing real project directory.');
  const schema = resolve(destination, 'src/db/schema.ts');
  assertNoSymlink(schema);
  if (!existsSync(schema) || !existsSync(resolve(destination, 'package.json'))) throw Error('Target must contain package.json and src/db/schema.ts.');
  const oldSchema = readFileSync(schema, 'utf8');
  if (oldSchema.includes('private-notes.schema')) throw Error('Recipe is already installed. Review/update your installed files manually.');
  const files = walk(root).map((source) => {
    const name = relative(root, source);
    const path = resolve(destination, name);
    if (!path.startsWith(`${destination}${sep}`)) throw Error('Unsafe destination.');
    assertNoSymlink(path);
    if (existsSync(path)) throw Error(`Refusing to overwrite existing file: ${name}`);
    return { source, path, name };
  });
  log(`Private notes target: ${destination}`);
  for (const file of files) log(`CREATE ${file.name}`);
  log('APPEND export to src/db/schema.ts');
  log('No migration, dependency install, credentials, network, or deployment is performed.');
  if (!execute) { log('Dry run only. Use --execute --confirm with the exact absolute target path after review.'); return files.map((file) => file.name); }
  if (confirm !== destination) throw Error('Execution requires --confirm matching the exact absolute target path.');
  const lock = resolve(destination, '.private-notes-install.lock');
  writeFileSync(lock, 'Local recipe installation in progress.\n', { flag: 'wx', mode: 0o600 });
  const created = [];
  try {
    for (const file of files) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, readFileSync(file.source), { flag: 'wx' });
      created.push(file.path);
    }
    // Refuse concurrent edits instead of overwriting an unexpected schema barrel.
    if (readFileSync(schema, 'utf8') !== oldSchema) throw Error('Schema changed during installation.');
    writeFileSync(schema, `${oldSchema.trimEnd()}\nexport * from './private-notes.schema';\n`);
    log('Installed. Next: npm run db:generate; review the new SQL, then npm run db:migrate:local.');
  } catch (error) {
    for (const path of created.reverse()) unlinkSync(path);
    throw error;
  } finally { unlinkSync(lock); }
  return files.map((file) => file.name);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { target: { type: 'string' }, execute: { type: 'boolean' }, confirm: { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) console.log('node examples/private-notes/apply.mjs [--target PATH] [--execute --confirm ABSOLUTE_PATH]\nDefault: preview only. Refuses overwrites and symlinks. Never migrates or deploys.');
    else applyPrivateNotes(values);
  } catch (error) { console.error(error instanceof Error ? error.message : 'Installation stopped.'); process.exitCode = 1; }
}
