import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function assertValidationBefore(file: string, sideEffect: string) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const validationAt = source.indexOf('assertUploadContent');
  const sideEffectAt = source.indexOf(sideEffect, validationAt + 1);
  assert.notEqual(validationAt, -1, `${file} must validate upload content`);
  assert.ok(sideEffectAt > validationAt, `${file} must validate before ${sideEffect}`);
}

await assertValidationBefore('../modules/conversation/conversation.routes.ts', 'uploadFile(');
await assertValidationBefore('../modules/storage/storage.routes.ts', 'uploadFile(');
await assertValidationBefore('../modules/storage/storage.routes.ts', 'uploadImagemapBase(');
await assertValidationBefore('../modules/channel/channel.routes.ts', 'uploadFile(');
await assertValidationBefore('../modules/knowledge/knowledge.routes.ts', 'parseFileToMarkdown(');
await assertValidationBefore('../modules/knowledge/partner-ingest.service.ts', 'uploadFile(');

process.exit(0);
