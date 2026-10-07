/**
 * 公開 WebChat 路由的濫用防護（主規格 webchat-public-abuse-controls），
 * 以及主規格 webchat-widget 在 API 端的訊息與上傳情境。
 *
 * `/api/v1/chatbox/*` 與 `/api/v1/webchat/:channelId/*` 是兩組各自實作的路由，
 * 適用兩組的情境，兩組都要測。
 */
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, beforeEach, test, vi } from 'vitest';

const service = vi.hoisted(() => ({
  createChatboxSession: vi.fn(),
  handleChatboxMessage: vi.fn(),
  uploadChatboxMedia: vi.fn(),
}));
vi.mock('#src/modules/chatbox/chatbox.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/chatbox/chatbox.service.js')>()),
  ...service,
}));

import { AppError } from '#src/shared/utils/response.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import chatboxRoutes from '#src/modules/chatbox/chatbox.routes.js';
import webchatRoutes from '#src/modules/webchat/webchat.routes.js';
import { getPublicWebchatKey, resetPublicWebchatLimits } from '#src/modules/webchat/public-webchat-limits.js';

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CHANNEL_ID = '44444444-4444-4444-8444-444444444444';
const CLAIM_TOKEN = 'claim-token-'.padEnd(40, 'c');

const families = [
  { name: 'chatbox', messages: '/api/v1/chatbox/messages', media: '/api/v1/chatbox/media' },
  {
    name: 'webchat',
    messages: `/api/v1/webchat/${CHANNEL_ID}/messages`,
    media: `/api/v1/webchat/${CHANNEL_ID}/media`,
  },
] as const;

function sessionId(n: number | string): string {
  return `cb2.session-${String(n).padStart(32, '0')}`;
}

/** 每個請求用不同的來源 IP，避開以 IP 計數的上限 */
function ip(n: number): string {
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

let channelOfSession: (id: string) => string;
let verifyFails: (id: string) => boolean;
const verifier = {
  verify: vi.fn(async (input: { sessionId: string }) => {
    if (verifyFails(input.sessionId)) {
      throw new AppError('聊天連線已失效，請重新整理頁面', 'UNAUTHORIZED', 401);
    }
    return {
      id: `verified-${input.sessionId}`,
      tenantId: 'tenant-1',
      channelId: channelOfSession(input.sessionId),
      conversationId: 'conversation-1',
      visitorToken: 'server-visitor-token',
    };
  }),
};
const channelFindFirst = vi.fn(async () => ({ id: CHANNEL_ID, tenantId: 'tenant-1', publicKey: 'ch_public' }));

const originalLegacyFlag = process.env.WEBCHAT_LEGACY_ROUTES_ENABLED;

beforeEach(() => {
  resetPublicWebchatLimits();
  channelOfSession = () => CHANNEL_ID;
  verifyFails = () => false;
  verifier.verify.mockClear();
  channelFindFirst.mockClear();
  service.createChatboxSession.mockReset().mockResolvedValue({
    sessionId: 'cb2.created-session',
    config: { channelId: CHANNEL_ID },
  });
  service.handleChatboxMessage.mockReset().mockResolvedValue({ duplicate: false, message: { id: 'message-1' } });
  service.uploadChatboxMedia.mockReset().mockResolvedValue({ url: 'https://cdn.test/file', contentType: 'image' });
});

afterEach(() => {
  vi.useRealTimers();
  if (originalLegacyFlag === undefined) delete process.env.WEBCHAT_LEGACY_ROUTES_ENABLED;
  else process.env.WEBCHAT_LEGACY_ROUTES_ENABLED = originalLegacyFlag;
});

async function buildApp(logs: string[] = []): Promise<FastifyInstance> {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      logs.push(chunk.toString());
      callback();
    },
  });
  const app = Fastify({ logger: { level: 'warn', stream } });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(errorHandlerPlugin);
  app.decorate('prismaAdmin', { channel: { findFirst: channelFindFirst } } as never);
  app.decorate('io', {} as never);
  app.decorate('chatboxSessionVerifier', verifier as never);
  app.decorate('chatboxMessageRegistry', {} as never);
  app.decorate('chatboxClaimRedis', {} as never);
  await app.register(chatboxRoutes, { prefix: '/api/v1/chatbox' });
  await app.register(webchatRoutes, { prefix: '/api/v1/webchat' });
  return app;
}

function messageBody(id: string, overrides: Record<string, unknown> = {}) {
  return {
    sessionId: id,
    claimToken: CLAIM_TOKEN,
    clientMessageId: `client-${id}`,
    type: 'text',
    payload: { text: 'hello' },
    ...overrides,
  };
}

function postMessage(app: FastifyInstance, url: string, body: unknown, remoteAddress = '10.0.0.1') {
  return app.inject({ method: 'POST', url, payload: body as Record<string, unknown>, remoteAddress });
}

function uploadMedia(
  app: FastifyInstance,
  url: string,
  fields: Record<string, string>,
  remoteAddress = '10.0.0.1',
  file = { name: 'image.png', type: 'image/png', content: 'png' },
) {
  const boundary = '----open333crm-test-boundary';
  const parts = Object.entries(fields).flatMap(([name, value]) => [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${name}"`,
    '',
    value,
  ]);
  const payload = [
    ...parts,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${file.name}"`,
    `Content-Type: ${file.type}`,
    '',
    file.content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
    remoteAddress,
  });
}

/** 路由自己的計數回 `{ code }`；`@fastify/rate-limit` 經錯誤處理回 `{ error: { code } }` */
function assertRateLimited(response: LightMyRequestResponse) {
  assert.equal(response.statusCode, 429);
  const body = response.json();
  assert.equal(body.code ?? body.error?.code, 'RATE_LIMITED');
  assert.ok(Number(response.headers['retry-after']) > 0, 'Retry-After 要是正數');
}

/** 擋下請求的計數鍵。上限互相重疊，所以要確認擋下的是情境指的那一個 */
function rejectedBy(logs: string[]): string | undefined {
  const entries = logs.map((line) => JSON.parse(line) as { msg?: string; limitKey?: string });
  return entries.filter((entry) => /rate limit exceeded/.test(String(entry.msg))).at(-1)?.limitKey;
}

// ── 舊的工作階段路由預設停用 ───────────────────────────────

test('以預設設定呼叫舊的工作階段路由：回 410，不查詢渠道，不建立工作階段', async () => {
  delete process.env.WEBCHAT_LEGACY_ROUTES_ENABLED;
  const app = await buildApp();

  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/webchat/${CHANNEL_ID}/sessions`,
    payload: { visitorToken: '33333333-3333-4333-8333-333333333333' },
  });

  assert.equal(response.statusCode, 410);
  assert.equal(response.json().code, 'WEBCHAT_LEGACY_ROUTE_RETIRED');
  assert.equal(channelFindFirst.mock.calls.length, 0);
  assert.equal(service.createChatboxSession.mock.calls.length, 0);
  await app.close();
});

test('啟用舊的工作階段路由：以 chatbox 流程建立工作階段，不使用 body 的 visitorToken', async () => {
  process.env.WEBCHAT_LEGACY_ROUTES_ENABLED = 'true';
  const app = await buildApp();
  const visitorToken = '33333333-3333-4333-8333-333333333333';

  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/webchat/${CHANNEL_ID}/sessions`,
    payload: { visitorToken },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.sessionId, 'cb2.created-session');
  assert.equal(service.createChatboxSession.mock.calls.length, 1);
  const input = service.createChatboxSession.mock.calls[0]![2];
  assert.equal(input.channelPublicKey, 'ch_public');
  assert.equal(JSON.stringify(service.createChatboxSession.mock.calls[0]).includes(visitorToken), false);
  await app.close();
});

// ── 公開請求的大小限制 ─────────────────────────────────────

for (const family of families) {
  test(`訊息請求的 body 超過 128 KB（${family.name}）：回 413，不驗證工作階段，不交給進站處理`, async () => {
    const app = await buildApp();

    const response = await postMessage(
      app,
      family.messages,
      messageBody(sessionId(1), { payload: { text: 'x'.repeat(130 * 1024) } }),
    );

    assert.equal(response.statusCode, 413);
    assert.equal(verifier.verify.mock.calls.length, 0);
    assert.equal(service.handleChatboxMessage.mock.calls.length, 0);
    await app.close();
  });
}

// ── 訊息與上傳請求的頻率限制 ───────────────────────────────

for (const family of families) {
  test(`同一個來源 IP 的訊息超過每分鐘上限（${family.name}）：回 429，不驗證工作階段，不交給進站處理`, async () => {
    const app = await buildApp();

    let accepted = 0;
    let rejected: LightMyRequestResponse | undefined;
    for (let i = 0; i < 100 && !rejected; i += 1) {
      const response = await postMessage(app, family.messages, messageBody(sessionId(i)), '10.0.0.1');
      if (response.statusCode === 200) accepted += 1;
      else rejected = response;
    }

    assert.ok(rejected, '同一個 IP 的請求要被擋下');
    assertRateLimited(rejected);
    assert.equal(verifier.verify.mock.calls.length, accepted);
    assert.equal(service.handleChatboxMessage.mock.calls.length, accepted);
    await app.close();
  });

  test(`同一個工作階段的訊息超過每分鐘上限（${family.name}）：驗證失敗的工作階段也計數，超過後不再驗證`, async () => {
    const logs: string[] = [];
    const app = await buildApp(logs);
    const id = sessionId('failing');
    verifyFails = (candidate) => candidate === id;

    const statuses: number[] = [];
    let rejected: LightMyRequestResponse | undefined;
    for (let i = 0; i < 100 && !rejected; i += 1) {
      const response = await postMessage(app, family.messages, messageBody(id), ip(i));
      if (response.statusCode === 429) rejected = response;
      else statuses.push(response.statusCode);
    }

    assert.ok(rejected, '同一個工作階段的請求要被擋下');
    assertRateLimited(rejected);
    assert.equal(rejectedBy(logs), getPublicWebchatKey('session', id));
    assert.ok(statuses.length > 0 && statuses.every((status) => status === 401));
    assert.equal(verifier.verify.mock.calls.length, statuses.length, '被擋下的請求不驗證工作階段');
    assert.equal(service.handleChatboxMessage.mock.calls.length, 0);
    await app.close();
  });

  test(`同一個渠道的訊息超過每分鐘上限（${family.name}）：回 429，不交給進站處理`, async () => {
    const logs: string[] = [];
    const app = await buildApp(logs);

    let accepted = 0;
    let rejected: LightMyRequestResponse | undefined;
    for (let i = 0; i < 1000 && !rejected; i += 1) {
      const response = await postMessage(app, family.messages, messageBody(sessionId(i)), ip(i));
      if (response.statusCode === 200) accepted += 1;
      else rejected = response;
    }

    assert.ok(rejected, '同一個渠道的請求要被擋下');
    assertRateLimited(rejected);
    assert.equal(rejectedBy(logs), getPublicWebchatKey('channel', CHANNEL_ID));
    assert.equal(service.handleChatboxMessage.mock.calls.length, accepted);
    await app.close();
  });

  test(`同一個工作階段的訊息超過每小時上限（${family.name}）：回 429，不交給進站處理`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = new Date('2026-10-07T00:00:00Z').getTime();
    const logs: string[] = [];
    const app = await buildApp(logs);
    const id = sessionId('hourly');

    let accepted = 0;
    let rejected: LightMyRequestResponse | undefined;
    for (let i = 0; i < 200 && !rejected; i += 1) {
      // 每分鐘只送 5 則，不會碰到每分鐘的上限
      vi.setSystemTime(start + Math.floor(i / 5) * 61_000);
      const response = await postMessage(app, family.messages, messageBody(id), ip(i));
      if (response.statusCode === 200) accepted += 1;
      else rejected = response;
    }

    assert.ok(rejected, '同一個工作階段一小時內的請求要被擋下');
    assert.ok(Date.now() - start < 60 * 60 * 1000, '要在一小時內被擋下');
    assertRateLimited(rejected);
    assert.equal(rejectedBy(logs), getPublicWebchatKey('session-ai', `verified-${id}`));
    assert.equal(service.handleChatboxMessage.mock.calls.length, accepted);
    await app.close();
  });

  test(`同一個渠道的訊息超過每小時上限（${family.name}）：回 429，不交給進站處理`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = new Date('2026-10-07T00:00:00Z').getTime();
    const logs: string[] = [];
    const app = await buildApp(logs);

    let accepted = 0;
    let rejected: LightMyRequestResponse | undefined;
    for (let i = 0; i < 5000 && !rejected; i += 1) {
      // 每分鐘送 100 則，不同工作階段、不同 IP，不會碰到每分鐘的上限
      vi.setSystemTime(start + Math.floor(i / 100) * 61_000);
      const response = await postMessage(app, family.messages, messageBody(sessionId(i)), ip(i));
      if (response.statusCode === 200) accepted += 1;
      else rejected = response;
    }

    assert.ok(rejected, '同一個渠道一小時內的請求要被擋下');
    assert.ok(Date.now() - start < 60 * 60 * 1000, '要在一小時內被擋下');
    assertRateLimited(rejected);
    assert.equal(rejectedBy(logs), getPublicWebchatKey('channel-ai', CHANNEL_ID));
    assert.equal(service.handleChatboxMessage.mock.calls.length, accepted);
    await app.close();
  });

  test(`上傳超過每分鐘上限（${family.name}）：同一個來源 IP 或同一個工作階段，回 429，不儲存檔案`, async () => {
    const logs: string[] = [];
    const app = await buildApp(logs);

    let accepted = 0;
    let rejected: LightMyRequestResponse | undefined;
    for (let i = 0; i < 100 && !rejected; i += 1) {
      const response = await uploadMedia(app, family.media, { sessionId: sessionId(i), claimToken: CLAIM_TOKEN }, '10.0.0.2');
      if (response.statusCode === 200) accepted += 1;
      else rejected = response;
    }
    assert.ok(rejected, '同一個 IP 的上傳要被擋下');
    assertRateLimited(rejected);
    assert.equal(service.uploadChatboxMedia.mock.calls.length, accepted);

    resetPublicWebchatLimits();
    service.uploadChatboxMedia.mockClear();
    accepted = 0;
    rejected = undefined;
    const id = sessionId('uploads');
    for (let i = 0; i < 100 && !rejected; i += 1) {
      const response = await uploadMedia(app, family.media, { sessionId: id, claimToken: CLAIM_TOKEN }, ip(1000 + i));
      if (response.statusCode === 200) accepted += 1;
      else rejected = response;
    }
    assert.ok(rejected, '同一個工作階段的上傳要被擋下');
    assertRateLimited(rejected);
    assert.equal(rejectedBy(logs), getPublicWebchatKey('session-media', id));
    assert.equal(service.uploadChatboxMedia.mock.calls.length, accepted);
    await app.close();
  });

  test(`訊息達到來源 IP 的上限後仍可上傳（${family.name}）：訊息不佔用上傳的 IP 計數`, async () => {
    // 先量出同一個 IP 每分鐘能上傳幾次，再用新的 app 與計數，從同一個 IP 送出同樣多則訊息
    const probe = await buildApp();
    let uploadLimit = 0;
    for (let i = 0; i < 100; i += 1) {
      const response = await uploadMedia(probe, family.media, { sessionId: sessionId(i), claimToken: CLAIM_TOKEN }, '10.0.0.4');
      if (response.statusCode !== 200) break;
      uploadLimit += 1;
    }
    await probe.close();
    resetPublicWebchatLimits();

    const app = await buildApp();
    for (let i = 0; i < uploadLimit; i += 1) {
      const response = await postMessage(app, family.messages, messageBody(sessionId(`m${i}`)), '10.0.0.4');
      assert.equal(response.statusCode, 200, '訊息要在訊息的上限以內');
    }

    const upload = await uploadMedia(app, family.media, { sessionId: sessionId('after'), claimToken: CLAIM_TOKEN }, '10.0.0.4');
    assert.equal(upload.statusCode, 200);
    await app.close();
  });
}

// ── 建立工作階段與訪客 socket 連線的頻率限制 ──────────────────

const sessionRoutes = [
  { name: 'chatbox', url: '/api/v1/chatbox/sessions', payload: { channel: 'ch_public' } },
  { name: '舊的工作階段路由', url: `/api/v1/webchat/${CHANNEL_ID}/sessions`, payload: {} },
] as const;

for (const route of sessionRoutes) {
  test(`同一個來源 IP 建立工作階段超過上限（${route.name}）：回 429，不建立工作階段`, async () => {
    process.env.WEBCHAT_LEGACY_ROUTES_ENABLED = 'true';
    const app = await buildApp();

    let accepted = 0;
    let rejected: LightMyRequestResponse | undefined;
    for (let i = 0; i < 100 && !rejected; i += 1) {
      const response = await app.inject({ method: 'POST', url: route.url, payload: route.payload, remoteAddress: '10.0.0.3' });
      if (response.statusCode === 200) accepted += 1;
      else rejected = response;
    }

    assert.ok(rejected, '同一個 IP 建立工作階段要被擋下');
    assertRateLimited(rejected);
    assert.equal(service.createChatboxSession.mock.calls.length, accepted);
    await app.close();
  });
}

// ── 頻率限制的計數鍵與日誌不含原始的工作階段憑證 ─────────────

for (const family of families) {
  test(`請求因頻率限制被拒絕（${family.name}）：warn 日誌有請求 ID 與計數鍵，沒有 sessionId 與 claim token`, async () => {
    const logs: string[] = [];
    const app = await buildApp(logs);
    const id = sessionId('logged');
    verifyFails = (candidate) => candidate === id;

    let rejected: LightMyRequestResponse | undefined;
    for (let i = 0; i < 100 && !rejected; i += 1) {
      const response = await postMessage(app, family.messages, messageBody(id), ip(i));
      if (response.statusCode === 429) rejected = response;
    }
    assert.ok(rejected);

    const entries = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
    const warn = entries.filter((entry) => entry.level === 40 && /rate limit exceeded/.test(String(entry.msg)));
    assert.equal(warn.length, 1);
    assert.equal(typeof warn[0]!.requestId, 'string');
    assert.match(String(warn[0]!.limitKey), /^[0-9a-f]{64}$/);
    for (const line of logs) {
      assert.equal(line.includes(id), false, '日誌不能有 sessionId');
      assert.equal(line.includes(CLAIM_TOKEN), false, '日誌不能有 claim token');
    }
    await app.close();
  });
}

// ── webchat-widget：Visitor message sending 的 API 端 ────────────

for (const family of families) {
  test(`Visitor sends a text message（${family.name}）：API 驗證工作階段後交給進站處理`, async () => {
    const app = await buildApp();
    const id = sessionId('text');

    const response = await postMessage(app, family.messages, messageBody(id));

    assert.equal(response.statusCode, 200);
    assert.equal(verifier.verify.mock.calls[0]![0].claimToken, CLAIM_TOKEN);
    assert.equal(service.handleChatboxMessage.mock.calls.length, 1);
    const input = service.handleChatboxMessage.mock.calls[0]![3];
    assert.equal(input.sessionId, id);
    assert.equal(input.claimToken, CLAIM_TOKEN);
    await app.close();
  });

  test(`Visitor sends an image（${family.name}）：API 以驗證過的工作階段儲存檔案`, async () => {
    const app = await buildApp();
    const id = sessionId('image');

    const response = await uploadMedia(app, family.media, { sessionId: id, claimToken: CLAIM_TOKEN });

    assert.equal(response.statusCode, 200);
    assert.equal(service.uploadChatboxMedia.mock.calls.length, 1);
    const [, session, , , mimetype] = service.uploadChatboxMedia.mock.calls[0]!;
    assert.equal(session.id, `verified-${id}`);
    assert.equal(session.channelId, CHANNEL_ID);
    assert.equal(mimetype, 'image/png');
    await app.close();
  });

  test(`Invalid visitorToken（${family.name}）：沒有憑證或驗證失敗時拒絕，不交給進站處理也不儲存檔案`, async () => {
    const app = await buildApp();
    const id = sessionId('invalid');

    const noClaimMessage = await postMessage(app, family.messages, messageBody(id, { claimToken: undefined }));
    assert.equal(noClaimMessage.statusCode, 400);
    const visitorTokenOnly = await postMessage(app, family.messages, {
      visitorToken: '33333333-3333-4333-8333-333333333333',
      contentType: 'text',
      content: { text: 'hello' },
    });
    assert.equal(visitorTokenOnly.statusCode, 400);
    const noClaimUpload = await uploadMedia(app, family.media, { sessionId: id });
    assert.ok([400, 401].includes(noClaimUpload.statusCode));

    verifyFails = () => true;
    const failedMessage = await postMessage(app, family.messages, messageBody(id));
    assert.equal(failedMessage.statusCode, 401);
    const failedUpload = await uploadMedia(app, family.media, { sessionId: id, claimToken: CLAIM_TOKEN });
    assert.equal(failedUpload.statusCode, 401);

    assert.equal(service.handleChatboxMessage.mock.calls.length, 0);
    assert.equal(service.uploadChatboxMedia.mock.calls.length, 0);
    await app.close();
  });
}

test('Session belongs to another channel：回 404，不交給進站處理也不儲存檔案', async () => {
  const app = await buildApp();
  channelOfSession = () => OTHER_CHANNEL_ID;
  const id = sessionId('other-channel');

  const message = await postMessage(app, `/api/v1/webchat/${CHANNEL_ID}/messages`, messageBody(id));
  const upload = await uploadMedia(app, `/api/v1/webchat/${CHANNEL_ID}/media`, { sessionId: id, claimToken: CLAIM_TOKEN });

  assert.equal(message.statusCode, 404);
  assert.equal(upload.statusCode, 404);
  assert.equal(service.handleChatboxMessage.mock.calls.length, 0);
  assert.equal(service.uploadChatboxMedia.mock.calls.length, 0);
  await app.close();
});
