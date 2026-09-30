/**
 * 渠道外部帳號 ID 的寫入與唯一限制（change fix-meta-webhook-page-routing，tasks 4.6）。
 *
 * - 驗證 FB 渠道時寫入粉專 ID；IG 寫入 user_id（不是 App 範圍的 id）
 * - 同一個帳號全平台只能連結一次：跨租戶、同租戶都回 409，且不標記為已驗證
 * - 更換 token 時清掉舊的帳號 ID，等重新驗證
 * - 驗證成功會清掉分派警示
 *
 * Meta Graph API 以假 fetch 取代。需要 DATABASE_URL（只接受本機資料庫）。
 * 執行：pnpm --filter @open333crm/api test:channel-external-account
 */
import './helpers/load-root-env.js';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '../config/env.js';
import { tenantScopedClient } from '../lib/tenant-db.js';
import { encryptCredentials, updateChannel, verifyChannel } from '../modules/channel/channel.service.js';

if (!process.env.DATABASE_URL) {
  console.log('SKIP channel-external-account：repo 根目錄 .env 與環境變數都沒有 DATABASE_URL');
  process.exit(0);
}

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

let failed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok - ${name}`);
    console.error(err);
  }
}

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

try {
  const tenantB = await prisma.tenant.create({ data: { name: `CI 帳號ID 租戶 B ${stamp}` } });
  cleanup.push(async () => {
    await prisma.tenantSettings.deleteMany({ where: { tenantId: tenantB.id } });
    await prisma.tenant.deleteMany({ where: { id: tenantB.id } });
  });
  const dbA = tenantScopedClient(prisma, T_A);
  const dbB = tenantScopedClient(prisma, tenantB.id);

  const PAGE = `9${stamp}`;
  graph[`fb-a-${stamp}`] = { id: PAGE, name: 'CI 粉專' };
  graph[`fb-b-${stamp}`] = { id: PAGE, name: 'CI 粉專（另一個租戶拿同一粉專的 token）' };
  graph[`fb-a2-${stamp}`] = { id: PAGE, name: 'CI 粉專（同租戶第二筆）' };
  graph[`fb-other-${stamp}`] = { id: `8${stamp}`, name: 'CI 另一個粉專' };
  graph[`ig-${stamp}`] = { id: `app-scoped-${stamp}`, user_id: `1784${stamp}`, username: 'ci_ig' };

  const fbA = await mkChannel(T_A, 'FB', `fb-a-${stamp}`, {
    webhookRouting: { reason: 'account_id_missing', accountId: null, lastAt: new Date().toISOString() },
  });
  const fbB = await mkChannel(tenantB.id, 'FB', `fb-b-${stamp}`);
  const fbA2 = await mkChannel(T_A, 'FB', `fb-a2-${stamp}`);
  const ig = await mkChannel(T_A, 'THREADS', `ig-${stamp}`);

  await check('FB 驗證：寫入粉專 ID，並清掉分派警示', async () => {
    await verifyChannel(dbA, fbA.id, T_A);
    assert.equal(await accountIdOf(fbA.id), PAGE);
    const s = (await prisma.channel.findUnique({ where: { id: fbA.id }, select: { settings: true } }))?.settings as Record<string, unknown>;
    assert.equal(s.webhookRouting, undefined, '驗證成功後分派警示應清掉');
  });

  await check('另一個租戶驗證同一個粉專：409，不寫入、不標記為已驗證', async () => {
    await assert.rejects(verifyChannel(dbB, fbB.id, tenantB.id), (err: { code?: string; statusCode?: number }) => {
      assert.equal(err.code, 'CHANNEL_ACCOUNT_ALREADY_LINKED');
      assert.equal(err.statusCode, 409);
      return true;
    });
    assert.equal(await accountIdOf(fbB.id), null);
    const row = await prisma.channel.findUnique({ where: { id: fbB.id }, select: { lastVerifiedAt: true } });
    assert.equal(row?.lastVerifiedAt, null, '重複時不可標記為已驗證');
  });

  await check('同租戶第二筆同一粉專：一樣 409', async () => {
    await assert.rejects(verifyChannel(dbA, fbA2.id, T_A), (err: { code?: string }) => err.code === 'CHANNEL_ACCOUNT_ALREADY_LINKED');
    assert.equal(await accountIdOf(fbA2.id), null);
  });

  await check('IG 驗證：寫入 user_id（IG 專業帳號 ID），不是 App 範圍的 id', async () => {
    await verifyChannel(dbA, ig.id, T_A);
    assert.equal(await accountIdOf(ig.id), `1784${stamp}`);
  });

  await check('更換 token：清掉舊的帳號 ID，等重新驗證', async () => {
    await updateChannel(dbA, fbA.id, T_A, { credentials: { pageAccessToken: `fb-other-${stamp}` } });
    assert.equal(await accountIdOf(fbA.id), null);
    // 重新驗證後寫入新粉專 ID
    await verifyChannel(dbA, fbA.id, T_A);
    assert.equal(await accountIdOf(fbA.id), `8${stamp}`);
  });

  await check('只改名稱、不動 token：帳號 ID 保留', async () => {
    await updateChannel(dbA, fbA.id, T_A, { displayName: `CI 帳號ID 改名 ${stamp}` });
    assert.equal(await accountIdOf(fbA.id), `8${stamp}`);
  });

  await check('一般設定儲存不會洗掉分派警示（系統維護欄位）', async () => {
    await prisma.$executeRaw`UPDATE channels SET settings = settings || '{"webhookRouting":{"reason":"unrouted_account"}}'::jsonb WHERE id = ${fbA.id}::uuid`;
    await updateChannel(dbA, fbA.id, T_A, { settings: { someUserSetting: 1 } });
    const s = (await prisma.channel.findUnique({ where: { id: fbA.id }, select: { settings: true } }))?.settings as Record<string, any>;
    assert.equal(s.webhookRouting?.reason, 'unrouted_account');
    assert.equal(s.someUserSetting, 1);
  });
} finally {
  for (const fn of cleanup) await fn().catch((err) => console.error('清理失敗', err));
  await prisma.$disconnect();
}

console.log(`# fail ${failed}`);
process.exit(failed === 0 ? 0 : 1);
