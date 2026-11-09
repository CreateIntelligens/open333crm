/**
 * 網站聊天室背景圖上傳的錯誤改成標準格式的中文訊息（issue #470）。
 * 原本回 { error: 'No file uploaded' } 與 { error: 'Unsupported background image type' }，
 * 格式不是 { success, error: { code, message } }，前端 getApiErrorMessage 讀不到訊息。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { afterAll, beforeAll, test, vi } from 'vitest';

vi.mock('#src/guards/rbac.guard.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requirePermission: () => async () => {},
}));
vi.mock('#src/services/channel-visibility.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertChannelVisible: async () => {},
}));

import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import channelRoutes from '#src/modules/channel/channel.routes.js';

const TENANT_A = 'a0000000-0000-0000-0000-000000000001';
const CHANNEL_ID = 'c0000000-0000-4000-8000-000000000001';
const BOUNDARY = '----open333-chatbox-bg-test';

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
  app = Fastify();
  app.decorate('authenticate', async (request: FastifyRequest) => {
    (request as any).agent = { id: 'agent-1', tenantId: TENANT_A, role: 'ADMIN' };
    (request as any).tenantPrisma = {
      channel: {
        findFirst: async () => ({ id: CHANNEL_ID, tenantId: TENANT_A, channelType: 'WEBCHAT', settings: {} }),
      },
    };
  });
  await app.register(errorHandlerPlugin);
  await app.register(multipart);
  await app.register(channelRoutes, { prefix: '/channels' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

test('背景圖類型不支援：回 400 標準格式中文訊息', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/channels/${CHANNEL_ID}/chatbox-theme/background`,
    ...multipartFile('note.txt', 'text/plain', Buffer.from('hello')),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error?.code, 'BAD_REQUEST');
  assert.equal(res.json().error?.message, '不支援這種檔案，請改用 PNG、JPG、WEBP');
});

test('沒有附檔案：回 400 標準格式中文訊息', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/channels/${CHANNEL_ID}/chatbox-theme/background`,
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="note"\r\n\r\nx\r\n--${BOUNDARY}--\r\n`),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error?.code, 'BAD_REQUEST');
  assert.equal(res.json().error?.message, '請選擇要上傳的檔案');
});
