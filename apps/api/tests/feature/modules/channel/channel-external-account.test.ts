/**
 * 渠道外部帳號 ID 的寫入與唯一限制（change fix-meta-webhook-page-routing，tasks 4.6）。
 *
 * - 驗證 FB 渠道時寫入粉專 ID；IG 寫入 user_id（不是 App 範圍的 id）
 * - 同一個帳號全平台只能連結一次：跨租戶、同租戶都回 409，且不標記為已驗證
 * - 更換 token 時清掉舊的帳號 ID，等重新驗證
 * - 驗證成功會清掉分派警示
 *
 * Meta Graph API 以假 fetch 取代。需要 DATABASE_URL（只接受本機資料庫）。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import { encryptCredentials, updateChannel, verifyChannel } from '#src/modules/channel/channel.service.js';

loadEnvConfig();
const prisma = new PrismaClient();
const stamp = Date.now();
const T_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';

/** 假的 Graph API：依 token 回傳對應的粉專／IG 帳號 */
const graph: Record<string, Record<string, unknown>> = {};
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const auth = new Headers(init?.headers).get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (url.includes('messenger_profile')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
  const info = graph[token];
  if (!info) return new Response(JSON.stringify({ error: { message: 'invalid token' } }), { status: 400 });
  // 確認 IG 有要求 user_id 欄位
  if (url.includes('graph.instagram.com') && !url.includes('user_id')) {
    return new Response(JSON.stringify({ id: info.id, username: info.username }), { status: 200 });
  }
  return new Response(JSON.stringify(info), { status: 200 });
}) as typeof fetch;

const cleanup: Array<() => Promise<unknown>> = [];
const mkChannel = async (tenantId: string, channelType: 'FB' | 'THREADS', token: string, settings: object = {}) => {
  const ch = await prisma.channel.create({
    data: {
      tenantId,
      channelType,
      displayName: `CI 帳號ID ${channelType} ${token}`,
      credentialsEncrypted: encryptCredentials({ pageAccessToken: token, appSecret: 's', verifyToken: 'v' }),
      settings: settings as never,
    },
  });
  cleanup.unshift(() => prisma.channel.deleteMany({ where: { id: ch.id } }));
  return ch;
};
const accountIdOf = async (id: string) =>
  (await prisma.channel.findUnique({ where: { id }, select: { externalAccountId: true } }))?.externalAccountId ?? null;

const tenantB = await prisma.tenant.create({ data: { name: `CI 帳號ID 租戶 B ${stamp}` } });
cleanup.push(async () => {
  await prisma.tenantSettings.deleteMany({ where: { tenantId: tenantB.id } });
  await prisma.tenant.deleteMany({ where: { id: tenantB.id } });
});
const dbA = tenantScopedClient(prisma, T_A);
const dbB = tenantScopedClient(prisma, tenantB.id);

const PAGE = `9${stamp}`;
graph[`fb-a-${stamp}`] = { id: PAGE, name: 'CI 粉專', category: 'Shopping' };
graph[`fb-b-${stamp}`] = { id: PAGE, name: 'CI 粉專（另一個租戶拿同一粉專的 token）', category: 'Shopping' };
graph[`fb-a2-${stamp}`] = { id: PAGE, name: 'CI 粉專（同租戶第二筆）', category: 'Shopping' };
graph[`fb-other-${stamp}`] = { id: `8${stamp}`, name: 'CI 另一個粉專', category: 'Shopping' };
graph[`fb-user-${stamp}`] = { id: `5${stamp}`, name: '某個人（使用者權杖，沒有 category）' };
graph[`ig-${stamp}`] = { id: `app-scoped-${stamp}`, user_id: `1784${stamp}`, username: 'ci_ig' };
graph[`ig-nouser-${stamp}`] = { id: `app-scoped-2-${stamp}`, username: 'ci_ig_2' };

const fbA = await mkChannel(T_A, 'FB', `fb-a-${stamp}`, {
  webhookRouting: { reason: 'account_id_missing', accountId: null, lastAt: new Date().toISOString() },
});
const fbB = await mkChannel(tenantB.id, 'FB', `fb-b-${stamp}`);
const fbA2 = await mkChannel(T_A, 'FB', `fb-a2-${stamp}`);
const ig = await mkChannel(T_A, 'THREADS', `ig-${stamp}`);
const fbUser = await mkChannel(T_A, 'FB', `fb-user-${stamp}`);
const igNoUser = await mkChannel(T_A, 'THREADS', `ig-nouser-${stamp}`);

test('FB 驗證：寫入粉專 ID，並清掉分派警示', async () => {
  await verifyChannel(dbA, fbA.id, T_A);
  assert.equal(await accountIdOf(fbA.id), PAGE);
  const s = (await prisma.channel.findUnique({ where: { id: fbA.id }, select: { settings: true } }))?.settings as Record<string, unknown>;
  assert.equal(s.webhookRouting, undefined, '驗證成功後分派警示應清掉');
});

test('另一個租戶驗證同一個粉專：409，不寫入、不標記為已驗證', async () => {
  await assert.rejects(verifyChannel(dbB, fbB.id, tenantB.id), (err: { code?: string; statusCode?: number }) => {
    assert.equal(err.code, 'CHANNEL_ACCOUNT_ALREADY_LINKED');
    assert.equal(err.statusCode, 409);
    return true;
  });
  assert.equal(await accountIdOf(fbB.id), null);
  const row = await prisma.channel.findUnique({ where: { id: fbB.id }, select: { lastVerifiedAt: true } });
  assert.equal(row?.lastVerifiedAt, null, '重複時不可標記為已驗證');
});

test('同租戶第二筆同一粉專：一樣 409', async () => {
  await assert.rejects(verifyChannel(dbA, fbA2.id, T_A), (err: { code?: string }) => err.code === 'CHANNEL_ACCOUNT_ALREADY_LINKED');
  assert.equal(await accountIdOf(fbA2.id), null);
});

test('IG 驗證：寫入 user_id（IG 專業帳號 ID），不是 App 範圍的 id', async () => {
  await verifyChannel(dbA, ig.id, T_A);
  assert.equal(await accountIdOf(ig.id), `1784${stamp}`);
});

test('更換 token：清掉舊的帳號 ID，等重新驗證', async () => {
  await updateChannel(dbA, fbA.id, T_A, { credentials: { pageAccessToken: `fb-other-${stamp}` } });
  assert.equal(await accountIdOf(fbA.id), null);
  // 重新驗證後寫入新粉專 ID
  await verifyChannel(dbA, fbA.id, T_A);
  assert.equal(await accountIdOf(fbA.id), `8${stamp}`);
});

test('只改名稱、不動 token：帳號 ID 保留', async () => {
  await updateChannel(dbA, fbA.id, T_A, { displayName: `CI 帳號ID 改名 ${stamp}` });
  assert.equal(await accountIdOf(fbA.id), `8${stamp}`);
});

test('一般設定儲存不會洗掉分派警示（系統維護欄位）', async () => {
  await prisma.$executeRaw`UPDATE channels SET settings = settings || '{"webhookRouting":{"reason":"unrouted_account"}}'::jsonb WHERE id = ${fbA.id}::uuid`;
  await updateChannel(dbA, fbA.id, T_A, { settings: { someUserSetting: 1 } });
  const s = (await prisma.channel.findUnique({ where: { id: fbA.id }, select: { settings: true } }))?.settings as Record<string, any>;
  assert.equal(s.webhookRouting?.reason, 'unrouted_account');
  assert.equal(s.someUserSetting, 1);
});
test('FB 填成個人使用者權杖（沒有 category）：驗證失敗、不寫帳號 ID', async () => {
  await assert.rejects(verifyChannel(dbA, fbUser.id, T_A), (e: { code?: string }) => e.code === 'CHANNEL_VERIFY_FAILED');
  assert.equal(await accountIdOf(fbUser.id), null);
});

test('IG 回應沒有 user_id：驗證失敗，不可假裝成功', async () => {
  await assert.rejects(verifyChannel(dbA, igNoUser.id, T_A), (e: { code?: string }) => e.code === 'CHANNEL_VERIFY_FAILED');
  assert.equal(await accountIdOf(igNoUser.id), null);
});

test('停用渠道：清空帳號 ID，不再佔住粉專', async () => {
  const before = await accountIdOf(fbA.id);
  assert.ok(before);
  await updateChannel(dbA, fbA.id, T_A, { isActive: false });
  assert.equal(await accountIdOf(fbA.id), null);
  await updateChannel(dbA, fbA.id, T_A, { isActive: true });
});

test('被別租戶「已停用」的渠道佔住：驗證時自動釋放並寫入（啟用中的仍擋）', async () => {
  // 租戶 B 的 fbB 直接寫入 PAGE 後停用（模擬舊資料：停用前沒清空）
  await prisma.channel.update({ where: { id: fbB.id }, data: { externalAccountId: PAGE, isActive: false } });
  await verifyChannel(dbA, fbA2.id, T_A);
  assert.equal(await accountIdOf(fbA2.id), PAGE, '應取回被停用渠道佔住的粉專');
  assert.equal(await accountIdOf(fbB.id), null, '停用渠道的帳號 ID 應被釋放');
  // 啟用中的持有者不受影響：fbB 重新啟用後驗證同一粉專仍 409
  await prisma.channel.update({ where: { id: fbB.id }, data: { isActive: true } });
  await assert.rejects(verifyChannel(dbB, fbB.id, tenantB.id), (e: { code?: string }) => e.code === 'CHANNEL_ACCOUNT_ALREADY_LINKED');
  assert.equal(await accountIdOf(fbA2.id), PAGE);
});

afterAll(async () => {
  for (const fn of cleanup) await fn().catch((err) => console.error('清理失敗', err));
  await prisma.$disconnect();
});
