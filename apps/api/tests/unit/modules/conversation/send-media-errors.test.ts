/**
 * 收件匣傳圖片、影片時，類型不符與檔案過大的錯誤訊息是中文（issue #470，
 * spec upload-content-detection「Conversation media errors are shown in Chinese」）。
 * 兩個檢查都在讀資料庫、偵測內容之前，所以不需要資料庫。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { afterAll, beforeAll, test, vi } from 'vitest';

vi.mock('#src/guards/rbac.guard.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requirePermission: () => async () => {},
  requirePermissionWhen: () => async () => {},
}));

import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import conversationRoutes from '#src/modules/conversation/conversation.routes.js';

const TENANT_A = 'a0000000-0000-0000-0000-000000000001';
const CONVERSATION_ID = 'c0000000-0000-4000-8000-000000000001';
const BOUNDARY = '----open333-send-media-test';
const MB = 1024 * 1024;

let app: FastifyInstance;

function multipartFile(filename: string, mimeType: string, buffer: Buffer) {
  const prefix = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat([prefix, buffer, suffix]),
  };
}

beforeAll(async () => {
  app = Fastify({ bodyLimit: 30 * MB });
  app.decorate('authenticate', async (request: FastifyRequest) => {
    (request as any).agent = { id: 'agent-1', tenantId: TENANT_A, role: 'ADMIN' };
  });
  await app.register(errorHandlerPlugin);
  await app.register(multipart, { limits: { fileSize: 25 * MB } });
  await app.register(conversationRoutes, { prefix: '/conversations' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

test('傳圖片送出不支援的類型：回 400 中文訊息並列出允許的格式', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/conversations/${CONVERSATION_ID}/send-image`,
    ...multipartFile('note.txt', 'text/plain', Buffer.from('hello')),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'BAD_REQUEST');
  assert.equal(res.json().error.message, '不支援這種檔案，請改用 PNG、JPG');
});

test('傳影片送出圖片：回 400 中文訊息並列出允許的格式', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/conversations/${CONVERSATION_ID}/send-video`,
    ...multipartFile('photo.png', 'image/png', Buffer.from('png')),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.message, '不支援這種檔案，請改用 MP4、MOV');
});

test('傳圖片超過 20 MB：回 400 中文訊息', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/conversations/${CONVERSATION_ID}/send-image`,
    ...multipartFile('big.png', 'image/png', Buffer.alloc(21 * MB)),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'BAD_REQUEST');
  assert.equal(res.json().error.message, '檔案超過上限 20 MB，請壓縮後再上傳');
});
