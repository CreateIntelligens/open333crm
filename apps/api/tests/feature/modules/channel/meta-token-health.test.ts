/**
 * FB／IG 權杖健康排程（change fix-meta-webhook-page-routing）：
 * 權杖失效 → 寫入 settings.tokenHealth、通知該租戶管理員（站內通知）；再跑一次不重複通知；
 * 恢復有效 → 清除失效狀態；停用渠道不檢查。
 * Meta Graph API 以假 fetch 取代；資料庫為 feature 測試資料庫。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';

process.env.EMAIL_DELIVERY_MODE = 'log';
const { PrismaClient } = await import('@prisma/client');
const { loadEnvConfig } = await import('#src/config/env.js');
const { encryptCredentials } = await import('#src/modules/channel/channel.service.js');
const { runMetaTokenHealthCheck } = await import('#src/modules/channel/meta-token-health.js');

loadEnvConfig();
const prisma = new PrismaClient();
const stamp = Date.now();
const T_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const emitted: Array<{ room: string; event: string }> = [];
const io = { to: (room: string) => ({ emit: (event: string) => emitted.push({ room, event }) }) } as never;

// 假 Graph API：bad-* 權杖回 190，其餘有效
const validTokens = new Set<string>();
/** 檢查某個權杖的當下要做的事（模擬檢查途中管理員剛好重新連結） */
const duringProbe = new Map<string, () => Promise<unknown>>();
globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
  const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  await duringProbe.get(token)?.();
  if (validTokens.has(token)) return new Response(JSON.stringify({ id: '1' }), { status: 200 });
  return new Response(JSON.stringify({ error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } }), { status: 400 });
}) as typeof fetch;

const admin = await prisma.agent.create({
  data: { tenantId: T_A, email: `ci-token-admin-${stamp}@example.test`, name: 'CI 權杖管理員', passwordHash: 'x', role: 'ADMIN' },
});
const mk = (name: string, token: string, isActive = true) =>
  prisma.channel.create({
    data: {
      tenantId: T_A,
      channelType: 'FB',
      displayName: `CI 權杖 ${name} ${stamp}`,
      isActive,
      credentialsEncrypted: encryptCredentials({ pageAccessToken: token, connectMode: 'platform' }),
    },
  });
const bad = await mk('失效', `bad-${stamp}`);
const off = await mk('停用', `bad-off-${stamp}`, false);

const healthOf = async (id: string) =>
  ((await prisma.channel.findUnique({ where: { id }, select: { settings: true } }))?.settings as Record<string, any>)?.tokenHealth;
const notificationsFor = (title: string) =>
  prisma.notification.count({ where: { tenantId: T_A, agentId: admin.id, type: 'channel_token_invalid', title: { contains: title } } });

test('權杖失效：寫入失效狀態，並以站內通知告知租戶管理員', async () => {
  await runMetaTokenHealthCheck(prisma, io);
  const h = await healthOf(bad.id);
  assert.equal(h?.status, 'invalid');
  assert.match(h?.reason ?? '', /validating access token/);
  assert.ok(h?.notifiedAt);
  assert.equal(await notificationsFor('CI 權杖 失效'), 1);
  assert.ok(emitted.some((e) => e.room === `agent:${admin.id}` && e.event === 'notification.new'), '即時推播給管理員');
});

test('再跑一次（3 天內）：不重複通知', async () => {
  await runMetaTokenHealthCheck(prisma, io);
  assert.equal(await notificationsFor('CI 權杖 失效'), 1);
});

test('滿 3 天仍失效：再提醒一次', async () => {
  await runMetaTokenHealthCheck(prisma, io, new Date(Date.now() + 73 * 3600_000));
  assert.equal(await notificationsFor('CI 權杖 失效'), 2);
});

test('停用的渠道不檢查、不通知', async () => {
  assert.equal(await healthOf(off.id), undefined);
  assert.equal(await notificationsFor('CI 權杖 停用'), 0);
});

test('權杖恢復有效：清除失效狀態', async () => {
  validTokens.add(`bad-${stamp}`);
  await runMetaTokenHealthCheck(prisma, io);
  const h = await healthOf(bad.id);
  assert.equal(h?.status, 'valid');
  assert.equal(h?.reason, undefined);
});

test('檢查途中權杖被換掉（重新連結）：不寫入舊權杖的結果、不通知', async () => {
  const racing = await mk('競態', `bad-race-${stamp}`);
  duringProbe.set(`bad-race-${stamp}`, () =>
    prisma.channel.update({
      where: { id: racing.id },
      data: { credentialsEncrypted: encryptCredentials({ pageAccessToken: `new-${stamp}`, connectMode: 'platform' }) },
    }),
  );
  try {
    await runMetaTokenHealthCheck(prisma, io);
    assert.equal(await healthOf(racing.id), undefined);
    assert.equal(await notificationsFor('CI 權杖 競態'), 0);
  } finally {
    duringProbe.clear();
    await prisma.channel.deleteMany({ where: { id: racing.id } });
  }
});

test('憑證解不開：視為失效，原因寫明要重新填權杖', async () => {
  const broken = await prisma.channel.create({
    data: { tenantId: T_A, channelType: 'FB', displayName: `CI 權杖 解不開 ${stamp}`, credentialsEncrypted: 'not-decryptable' },
  });
  try {
    await runMetaTokenHealthCheck(prisma, io);
    const h = await healthOf(broken.id);
    assert.equal(h?.status, 'invalid');
    assert.match(h?.reason ?? '', /無法解密/);
  } finally {
    await prisma.notification.deleteMany({ where: { agentId: admin.id, title: { contains: '解不開' } } });
    await prisma.channel.deleteMany({ where: { id: broken.id } });
  }
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { agentId: admin.id } });
  await prisma.channel.deleteMany({ where: { id: { in: [bad.id, off.id] } } });
  await prisma.agent.deleteMany({ where: { id: admin.id } });
  await prisma.$disconnect();
});
