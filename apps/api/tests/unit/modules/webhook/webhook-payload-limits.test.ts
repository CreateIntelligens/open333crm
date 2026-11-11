/**
 * 進站 webhook 套用相同的 JSON 內容上限（change limit-request-array-size，spec request-payload-limits
 * 「進站 webhook 套用相同的上限」）。webhook 用自己的解析器保留原始內容驗簽，所以要在那個解析器裡也掃描。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';

const verifyCalls: { channelId: string; rawBody: unknown }[] = [];

vi.mock('#src/modules/webhook/webhook.service.js', () => ({
  verifyWebhookRequest: async (_prisma: unknown, channelId: string, _type: string, rawBody: unknown) => {
    verifyCalls.push({ channelId, rawBody });
    return { ok: false, reason: 'channel_not_found' };
  },
  processWebhookEvent: async () => {},
  processPlatformMetaWebhook: async () => {},
}));

import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import jsonPayloadGuardPlugin from '#src/plugins/json-payload-guard.plugin.js';
import { DEFAULT_JSON_PAYLOAD_LIMITS } from '#src/shared/utils/json-payload-limits.js';
import webhookRoutes from '#src/modules/webhook/webhook.routes.js';

const CHANNEL = 'c0000000-0000-0000-0000-000000000001';
let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.decorate('prismaAdmin', {} as never);
  app.decorate('io', { to: () => ({ emit() {} }) } as never);
  await app.register(errorHandlerPlugin);
  await app.register(jsonPayloadGuardPlugin, { limits: DEFAULT_JSON_PAYLOAD_LIMITS });
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  verifyCalls.length = 0;
});

function lineEvent(i: number) {
  return { type: 'message', webhookEventId: `e${i}`, message: { type: 'text', text: 'hi' } };
}

test('LINE webhook 的 events 超過上限', async () => {
  const payload = { destination: 'U1', events: Array.from({ length: 10_001 }, (_, i) => i) };
  const res = await app.inject({ method: 'POST', url: `/api/v1/webhooks/line/${CHANNEL}`, payload });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'PAYLOAD_ARRAY_TOO_LARGE');
  assert.equal(res.json().error.details.path, 'events');
  assert.equal(verifyCalls.length, 0);
});

test('一般大小的 webhook 照常處理', async () => {
  const payload = { destination: 'U1', events: [lineEvent(1)] };
  const res = await app.inject({ method: 'POST', url: `/api/v1/webhooks/line/${CHANNEL}`, payload });
  assert.equal(res.statusCode, 200);
  assert.equal(verifyCalls.length, 1);
  assert.ok(Buffer.isBuffer(verifyCalls[0].rawBody));
  assert.equal((verifyCalls[0].rawBody as Buffer).toString(), JSON.stringify(payload));
});

test('Meta 一次最多 1,000 筆 entry 的批次照常處理', async () => {
  const payload = { object: 'page', entry: Array.from({ length: 1_000 }, (_, i) => ({ id: `p${i}`, messaging: [{}] })) };
  const res = await app.inject({ method: 'POST', url: `/api/v1/webhooks/fb/${CHANNEL}`, payload });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'EVENT_RECEIVED');
});
