import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function compile(source: string) {
  const file = resolve('mail-template-contract-fixture.ts');
  const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, types: [] };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, error, fresh) => name === file
    ? ts.createSourceFile(file, source, language, true)
    : original(name, language, error, fresh);
  const program = ts.createProgram([file], options, host);
  return ts.getPreEmitDiagnostics(program).map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n'));
}

describe('documented email union extension', () => {
  it('accepts a new literal union member without requiring a second context-map edit', () => {
    const source = readFileSync('src/mail/types.ts', 'utf8').replace(
      '| "contactMessage"\n\t| keyof EmailTemplateContexts;',
      '| "contactMessage"\n\t| "documentedCustom"\n\t| keyof EmailTemplateContexts;',
    );
    expect(source).toContain('| "documentedCustom"');
    expect(compile(`${source}
      declare function send(input: SendTemplateParams): void;
      send({ to: 'fixture@example.invalid', template: 'documentedCustom', context: { username: 'Fixture', actionUrl: 'https://example.invalid/preview' } });
      send({ to: 'fixture@example.invalid', template: 'verifyEmail', context: { name: 'Fixture', url: 'https://example.invalid/preview' } });
      // @ts-expect-error Built-in context remains strongly typed.
      send({ to: 'fixture@example.invalid', template: 'verifyEmail', context: { name: 'Fixture' } });
      // @ts-expect-error Unknown names are still not in the public union.
      send({ to: 'fixture@example.invalid', template: 'notRegistered', context: {} });
    `)).toEqual([]);
  });
  it('retains optional context augmentation and rejects missing custom required fields', () => {
    const source = readFileSync('src/mail/types.ts', 'utf8');
    expect(compile(`${source}
      export interface EmailTemplateContexts { typedCustom: { project: string } }
      declare function send(input: SendTemplateParams): void;
      send({ to: 'fixture@example.invalid', template: 'typedCustom', context: { project: 'Preview' } });
      // @ts-expect-error Optional augmentation is enforced once declared.
      send({ to: 'fixture@example.invalid', template: 'typedCustom', context: {} });
    `)).toEqual([]);
  });
});
