process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-message-privacy-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { AppError } from '#src/shared/utils/response.js';
import { prepareStoredMessageContent, readModelMessageContent } from '#src/modules/ai/deidentification.service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PHONE = '0912345678';
const EMAIL = 'qa@example.invalid';
const mask = (text: string) => text.replaceAll(PHONE, '[手機]').replaceAll(EMAIL, '[電子郵件]');
const calls = vi.fn();

function db(policy: unknown = { enabled: true }) {
  return { platformSetting: { findUnique: async () => policy === null ? null : { value: policy } } };
}

beforeEach(() => {
  calls.mockReset();
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
    const request = JSON.parse(options.body as string);
    calls(request);
    return Response.json({ code: 200, data: { status: 'ok', text: mask(request.text), mappings: [{ original: PHONE }], csvMapping: PHONE } });
  });
});
afterEach(() => vi.unstubAllGlobals());

test('Inbound channel message keeps an operational original', async () => {
  const prepared = await prepareStoredMessageContent(db() as never, TENANT, { text: `請聯絡 ${PHONE}`, quickReplies: [{ label: EMAIL }] }, 'inbound');
  assert.equal((prepared.content as { text: string }).text, `請聯絡 ${PHONE}`);
  assert.deepEqual(prepared.metadata.privacy, {
    version: 1,
    mode: 'inbound',
    maskedContent: { text: '請聯絡 [手機]', quickReplies: [{ label: '[電子郵件]' }] },
  });
  assert.equal(readModelMessageContent(prepared.content, prepared.metadata), '請聯絡 [手機]');
});

test('Default masked agent reply', async () => {
  const prepared = await prepareStoredMessageContent(db() as never, TENANT, { text: `我的電話 ${PHONE}` }, 'agent_default');
  assert.equal((prepared.content as { text: string }).text, '我的電話 [手機]');
  assert.equal((prepared.metadata.privacy as { mode: string }).mode, 'mask');
});

test('Agent preserves original reply', async () => {
  const prepared = await prepareStoredMessageContent(db() as never, TENANT, { text: `我的電話 ${PHONE}` }, 'agent_original');
  assert.equal((prepared.content as { text: string }).text, `我的電話 ${PHONE}`);
  assert.equal((prepared.metadata.privacy as { mode: string }).mode, 'original');
  assert.equal(readModelMessageContent(prepared.content, prepared.metadata), '我的電話 [手機]');
});

test('System-created message is protected', async () => {
  const prepared = await prepareStoredMessageContent(db() as never, TENANT, { text: EMAIL }, 'system');
  assert.equal((prepared.content as { text: string }).text, '[電子郵件]');
  assert.equal(readModelMessageContent(prepared.content, prepared.metadata), '[電子郵件]');
});

test('Disabled policy does not add a forced mask', async () => {
  const prepared = await prepareStoredMessageContent(db({ enabled: false }) as never, TENANT, { text: PHONE }, 'agent_default');
  assert.deepEqual(prepared, { content: { text: PHONE }, metadata: {} });
  assert.equal(calls.mock.calls.length, 0);
});

test('Masking storage failure preserves no unclassified model path', async () => {
  vi.stubGlobal('fetch', async () => new Response(PHONE, { status: 503 }));
  await assert.rejects(
    prepareStoredMessageContent(db() as never, TENANT, { text: PHONE }, 'inbound'),
    (error: unknown) => error instanceof AppError && error.code === 'AI_DEIDENTIFICATION_UNAVAILABLE' && !error.message.includes(PHONE),
  );
});
