/**
 * 測試 LIFF 設定（change add-liff-config-test，spec channel-management「產生 LIFF 設定的測試連結」
 * 「手機回報 LIFF 測試結果」「查詢 LIFF 測試結果」「LIFF 測試紀錄由系統維護」）。
 *
 * 走真實路由、權限計算與 app_tenant 連線（RLS 生效）；Redis 以記憶體替身、向 LINE 驗證 ID token 以替身取代。
 * 資料加標記並在 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import channelRoutes from '#src/modules/channel/channel.routes.js';
import liffTestPublicRoutes from '#src/modules/channel/liff-test-public.routes.js';
import type { LiffTestDeps } from '#src/modules/channel/liff-test.flow.js';
import type { LineIdTokenCheck } from '#src/modules/coupon/line-id-token.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-liff-test-${Date.now()}`;
const LIFF_ID = '1660000000-abcdefgh';
const LOGIN_ID = '1660000001';
const FRIEND_UID = `U${MARK}-friend`;

const createRole = (slug: string, codes: string[]) =>
  owner.role.create({
    data: {
      tenantId: TENANT_A,
      slug: `${MARK}-${slug}`,
      name: `${MARK}-${slug}`,
      permissions: { create: codes.map((permissionCode) => ({ permissionCode })) },
    },
  });
const updateRole = await createRole('update', ['channel.view', 'channel.update']);
const viewRole = await createRole('view', ['channel.view']);

const createChannel = (tenantId: string, channelType: 'LINE' | 'FB', slug: string, settings: Record<string, unknown>) =>
  owner.channel.create({
    data: { tenantId, channelType, isActive: true, displayName: `${MARK}-${slug}`, credentialsEncrypted: 'x', settings: settings as never },
  });
const configured = { liffConfig: { liffId: LIFF_ID, loginChannelId: LOGIN_ID } };
const line = await createChannel(TENANT_A, 'LINE', 'line', configured);
const otherLine = await createChannel(TENANT_A, 'LINE', 'line-2', configured);
const liffOnly = await createChannel(TENANT_A, 'LINE', 'liff-only', { liffConfig: { liffId: LIFF_ID } });
const fb = await createChannel(TENANT_A, 'FB', 'fb', configured);
const tenantBLine = await createChannel(TENANT_B, 'LINE', 'line-b', configured);

const friend = await owner.contact.create({ data: { tenantId: TENANT_A, displayName: `${MARK}-friend` } });
await owner.channelIdentity.create({ data: { contactId: friend.id, channelId: line.id, channelType: 'LINE', uid: FRIEND_UID } });

// ── 替身：記憶體 Redis、向 LINE 驗證 ──
const clock = { now: Date.now() };
const store = memBindingStore(clock);
const lineCalls: Array<{ idToken: string; clientId: string }> = [];
const TOKENS: Record<string, LineIdTokenCheck> = {
  friend: { result: 'ok', sub: FRIEND_UID },
  stranger: { result: 'ok', sub: `U${MARK}-stranger` },
  bad: { result: 'rejected' },
  down: { result: 'unreachable' },
};
const liffTest: Partial<LiffTestDeps> = {
  store,
  now: () => clock.now,
  checkIdToken: async (idToken, clientId) => {
    lineCalls.push({ idToken, clientId });
    return TOKENS[idToken] ?? { result: 'rejected' };
  },
};

const apps: FastifyInstance[] = [];
async function adminApp(roleId: string) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: '00000000-0000-4000-8000-0000000000d3', tenantId: TENANT_A, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, TENANT_A);
  });
  await app.register(channelRoutes, { prefix: '/api/v1/channels', liffTest });
  await app.ready();
  apps.push(app);
  return app;
}
const admin = await adminApp(updateRole.id);
const viewer = await adminApp(viewRole.id);

const fan = Fastify();
await fan.register(errorHandlerPlugin);
fan.decorate('prisma', tenantDb);
await fan.register(liffTestPublicRoutes, { prefix: '/api/v1/fan/liff-test', liffTest });
await fan.ready();
apps.push(fan);

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await owner.channelIdentity.deleteMany({ where: { contactId: friend.id } });
  await owner.contact.deleteMany({ where: { id: friend.id } });
  await owner.channel.deleteMany({ where: { displayName: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { slug: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

beforeEach(() => {
  lineCalls.length = 0;
});

const start = (channelId: string, app = admin) => app.inject({ method: 'POST', url: `/api/v1/channels/${channelId}/liff-test` });
async function startTest(channelId = line.id): Promise<string> {
  const res = await start(channelId);
  assert.equal(res.statusCode, 200, res.body);
  return res.json().data.testId as string;
}
const report = (body: Record<string, unknown>) => fan.inject({ method: 'POST', url: '/api/v1/fan/liff-test', payload: body });
const result = (channelId: string, testId: string) =>
  admin.inject({ method: 'GET', url: `/api/v1/channels/${channelId}/liff-test/${testId}` });
async function liffTestRecord(channelId = line.id) {
  const row = await owner.channel.findUniqueOrThrow({ where: { id: channelId }, select: { settings: true } });
  return (row.settings as { liffTest?: Record<string, unknown> } | null)?.liffTest;
}
async function resetLiffTestRecord() {
  await owner.$executeRaw`UPDATE channels SET settings = settings - 'liffTest' WHERE id = ${line.id}::uuid`;
}

describe('產生 LIFF 設定的測試連結', () => {
  it('已設定的 LINE 渠道產生測試連結', async () => {
    const res = await start(line.id);
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json().data;
    assert.match(data.testId, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(data.testUrl, `https://liff.line.me/${LIFF_ID}?lt=${data.testId}&lid=${LIFF_ID}`);
    assert.match(data.qrCode, /^data:image\/png;base64,/);
    assert.equal(new Date(data.expiresAt).getTime(), clock.now + 10 * 60 * 1000);
  });

  it('沒有設定完整時不產生', async () => {
    const res = await start(liffOnly.id);
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'LIFF_NOT_CONFIGURED');
  });

  it('不是 LINE 渠道', async () => {
    const res = await start(fb.id);
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'LIFF_NOT_CONFIGURED');
  });

  it('其他租戶的渠道', async () => {
    const res = await start(tenantBLine.id);
    assert.equal(res.statusCode, 404, res.body);
  });

  it('沒有權限', async () => {
    const res = await start(line.id, viewer);
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.details.requiredPermission, 'channel.update');
  });
});

describe('手機回報 LIFF 測試結果', () => {
  it('設定正確且是官方帳號的聯絡人', async () => {
    await resetLiffTestRecord();
    const testId = await startTest();
    const res = await report({ testId, idToken: 'friend' });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.status, 'verified');
    assert.deepEqual(lineCalls, [{ idToken: 'friend', clientId: LOGIN_ID }]);
    const record = await liffTestRecord();
    assert.equal(record?.liffId, LIFF_ID);
    assert.equal(record?.loginChannelId, LOGIN_ID);
    assert.equal(record?.verifiedAt, new Date(clock.now).toISOString());
  });

  it('LINE 帳號不在這個官方帳號的聯絡人裡', async () => {
    await resetLiffTestRecord();
    // 好友的 LINE 身分屬於 line，不屬於 otherLine：同一個人換到另一個官方帳號也不算
    const testId = await startTest(otherLine.id);
    const res = await report({ testId, idToken: 'friend' });
    assert.equal(res.json().data.status, 'not_a_friend');
    assert.match(res.json().data.message, /好友/);
    assert.match(res.json().data.message, /Provider/);
    assert.equal(await liffTestRecord(otherLine.id), undefined);

    const stranger = await report({ testId: await startTest(), idToken: 'stranger' });
    assert.equal(stranger.json().data.status, 'not_a_friend');
    assert.equal(await liffTestRecord(), undefined);
  });

  it('ID token 跟 Login Channel ID 不符', async () => {
    await resetLiffTestRecord();
    const res = await report({ testId: await startTest(), idToken: 'bad' });
    assert.equal(res.json().data.status, 'id_token_rejected');
    assert.equal(await liffTestRecord(), undefined);
  });

  it('連不上 LINE', async () => {
    await resetLiffTestRecord();
    const res = await report({ testId: await startTest(), idToken: 'down' });
    assert.equal(res.json().data.status, 'line_unreachable');
    assert.equal(await liffTestRecord(), undefined);
  });

  it('手機回報 LIFF 端的失敗', async () => {
    const res = await report({ testId: await startTest(), failure: 'no_id_token' });
    assert.equal(res.json().data.status, 'no_id_token');
    assert.match(res.json().data.message, /openid/);
    assert.deepEqual(lineCalls, []);

    const init = await report({ testId: await startTest(), failure: 'init_failed' });
    assert.equal(init.json().data.status, 'init_failed');
  });

  it('測試連結過期或不存在', async () => {
    const missing = await report({ testId: 'A'.repeat(43), idToken: 'friend' });
    assert.equal(missing.statusCode, 410, missing.body);
    assert.equal(missing.json().error.code, 'LIFF_TEST_EXPIRED');

    const testId = await startTest();
    clock.now += 10 * 60 * 1000 + 1;
    const expired = await report({ testId, idToken: 'friend' });
    assert.equal(expired.statusCode, 410, expired.body);
    assert.deepEqual(lineCalls, []);
    assert.equal((await result(line.id, testId)).json().data.status, 'expired');
  });
});

describe('查詢 LIFF 測試結果', () => {
  it('還沒收到回報', async () => {
    const res = await result(line.id, await startTest());
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.status, 'pending');
  });

  it('收到回報後', async () => {
    const testId = await startTest();
    const reported = (await report({ testId, idToken: 'stranger' })).json().data;
    const res = await result(line.id, testId);
    assert.equal(res.json().data.status, 'not_a_friend');
    assert.equal(res.json().data.message, reported.message);
  });

  it('其他渠道的測試', async () => {
    const testId = await startTest(otherLine.id);
    const res = await result(line.id, testId);
    assert.equal(res.statusCode, 404, res.body);
  });
});

describe('LIFF 測試紀錄由系統維護', () => {
  const recorded = { verifiedAt: '2026-10-29T00:00:00.000Z', liffId: LIFF_ID, loginChannelId: LOGIN_ID };
  const patch = (settings: Record<string, unknown>) =>
    admin.inject({ method: 'PATCH', url: `/api/v1/channels/${line.id}`, payload: { settings } });

  it('Bot 設定整包存檔不會洗掉測試紀錄', async () => {
    await owner.$executeRaw`UPDATE channels SET settings = settings || ${JSON.stringify({ liffTest: recorded })}::jsonb WHERE id = ${line.id}::uuid`;
    const res = await patch({ ...configured, firstContactGreeting: '你好' });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(await liffTestRecord(), recorded);
  });

  it('不能從 API 偽造測試紀錄', async () => {
    const res = await patch({ ...configured, liffTest: { ...recorded, verifiedAt: '2030-01-01T00:00:00.000Z' } });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(await liffTestRecord(), recorded);
  });
});
