/**
 * 平台 Meta App：租戶以 Facebook 登入連結粉專＋平台 webhook（change fix-meta-webhook-page-routing，tasks 7.7）。
 *
 * Graph API 以假 fetch 取代、Redis 以記憶體 store 取代；資料庫用本機真實 DB。
 * 需要 DATABASE_URL（只接受本機資料庫）。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import crypto from 'node:crypto';

process.env.META_APP_ID = 'ci-platform-app';
process.env.META_APP_SECRET = 'ci-platform-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'ci-verify';
process.env.META_CONNECT_REDIRECT_URI = 'https://crm.example.test/api/v1/meta-connect/callback';
delete process.env.META_LOGIN_CONFIG_ID;

const { PrismaClient } = await import('@prisma/client');
const { registerChannelPlugin, fbPlugin } = await import('@open333crm/channel-plugins');
const { loadEnvConfig } = await import('#src/config/env.js');
const { tenantScopedClient } = await import('#src/lib/tenant-db.js');
const { decryptCredentials, encryptCredentials } = await import('#src/modules/channel/channel.service.js');
const svc = await import('#src/modules/meta-connect/meta-connect.service.js');
const { processPlatformMetaWebhook } = await import('#src/modules/webhook/webhook.service.js');
const { memBindingStore } = await import('#tests/support/mem-binding-store.js');

loadEnvConfig();
registerChannelPlugin(fbPlugin);
const prisma = new PrismaClient();
const io = { to: () => ({ emit: () => {} }), emit: () => {} } as never;
const stamp = Date.now();
const T_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const OTHER_AGENT = '00000000-0000-4000-8000-0000000000a2';
const PAGE_OK = `71${stamp}`;
const PAGE_FAIL = `72${stamp}`;
const PAGE_TAKEN = `73${stamp}`;
const PAGE_P2 = `74${stamp}`; // 第二頁的粉專
const PAGE_FALSE = `75${stamp}`; // 訂閱回 success:false
const unsubscribeCalls: string[] = [];

// ── 假 Graph API ────────────────────────────────────────────────────────────
const subscribeCalls: Array<{ pageId: string; token: string }> = [];
let failSubscribeFor = new Set<string>([PAGE_FAIL]);
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const auth = new Headers(init?.headers).get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (url.includes('/oauth/access_token') && url.includes('code=GOOD')) return json({ access_token: 'short-user-token' });
  if (url.includes('/oauth/access_token') && url.includes('fb_exchange_token=short-user-token')) return json({ access_token: 'long-user-token' });
  if (url.includes('/oauth/access_token')) return json({ error: { message: 'bad code' } }, 400);
  const pageRow = (id: string) => ({ id, name: `CI 平台粉專 ${id}`, access_token: `page-token-${id}`, picture: { data: { url: 'https://x/p.png' } } });
  if (url.includes('/me/accounts') && url.includes('after=CURSOR2') && auth === 'long-user-token') {
    return json({ data: [pageRow(PAGE_P2)] });
  }
  if (url.includes('/me/accounts') && auth === 'long-user-token') {
    assert.ok(url.includes('appsecret_proof='), '取粉專清單要帶 appsecret_proof');
    return json({
      data: [PAGE_OK, PAGE_FAIL, PAGE_TAKEN, PAGE_FALSE].map(pageRow),
      paging: { next: 'https://graph.facebook.com/v21.0/me/accounts?limit=100&after=CURSOR2' },
    });
  }
  const sub = url.match(/\/(\d+)\/subscribed_apps(\?|$)/);
  if (sub && init?.method === 'DELETE') {
    unsubscribeCalls.push(sub[1]!);
    return json({ success: true });
  }
  if (sub && init?.method === 'POST') {
    subscribeCalls.push({ pageId: sub[1]!, token: auth });
    if (sub[1] === PAGE_FALSE) return json({ success: false });
    return failSubscribeFor.has(sub[1]!) ? json({ error: { message: 'no permission' } }, 403) : json({ success: true });
  }
  // 連結後的 verifyChannel（粉專權杖回應帶 category）
  if (url.includes('/me?fields=id,name,username')) return json({ id: auth.replace('page-token-', ''), name: 'CI', username: `ci_${auth.slice(-4)}`, category: 'Shopping' });
  if (url.includes('messenger_profile')) return json({ data: [] });
  return json({ error: { message: `unexpected ${url}` } }, 404);
}) as typeof fetch;

const store = memBindingStore();
const actor = { tenantId: T_A, agentId: AGENT };
const stateFrom = (url: string) => new URL(url).searchParams.get('state')!;
/** 模擬「發起授權的同一個瀏覽器」帶回的綁定 cookie */
const browserOf = (url: string) => svc.stateBinding(stateFrom(url));
const cleanup: Array<() => Promise<unknown>> = [];

const tenantB = await prisma.tenant.create({ data: { name: `CI 平台連結租戶 B ${stamp}` } });
cleanup.push(async () => {
  await prisma.tenantSettings.deleteMany({ where: { tenantId: tenantB.id } });
  await prisma.tenant.deleteMany({ where: { id: tenantB.id } });
});
// PAGE_TAKEN 已被另一個租戶連結
await prisma.channel.create({
  data: {
    tenantId: tenantB.id,
    channelType: 'FB',
    displayName: `CI 平台連結 已被連結 ${stamp}`,
    externalAccountId: PAGE_TAKEN,
    credentialsEncrypted: encryptCredentials({ pageAccessToken: 'x', appSecret: 'y' }),
  },
});
cleanup.unshift(async () => {
  const chans = await prisma.channel.findMany({ where: { displayName: { startsWith: 'CI 平台' } }, select: { id: true } });
  const ids = chans.map((c) => c.id);
  const convs = await prisma.conversation.findMany({ where: { channelId: { in: ids } }, select: { id: true } });
  await prisma.message.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } });
  await prisma.conversation.deleteMany({ where: { channelId: { in: ids } } });
  const idents = await prisma.channelIdentity.findMany({ where: { channelId: { in: ids } }, select: { contactId: true } });
  await prisma.channelIdentity.deleteMany({ where: { channelId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { id: { in: idents.map((i) => i.contactId) } } });
  await prisma.channel.deleteMany({ where: { id: { in: ids } } });
});
const db = tenantScopedClient(prisma, T_A);

test('start：產生含 state 的 Facebook 登入網址（未設定 config ID 時用 scope）', async () => {
  const { url } = await svc.startConnect(store, actor);
  const u = new URL(url);
  assert.equal(u.searchParams.get('client_id'), 'ci-platform-app');
  assert.equal(u.searchParams.get('redirect_uri'), process.env.META_CONNECT_REDIRECT_URI);
  assert.ok(u.searchParams.get('scope')?.includes('pages_messaging'));
  assert.ok(stateFrom(url).length >= 20);
});

test('callback：不存在的 state 被拒', async () => {
  const r = await svc.handleCallback(store, { state: 'forged-state', code: 'GOOD' }, svc.stateBinding('forged-state'));
  assert.deepEqual(r, { ok: false, reason: 'invalid_state' });
});

test('callback：使用者取消授權 → denied，且 state 已作廢', async () => {
  const { url } = await svc.startConnect(store, actor);
  const state = stateFrom(url);
  assert.deepEqual(await svc.handleCallback(store, { state, error: 'access_denied' }, browserOf(url)), { ok: false, reason: 'denied' });
  assert.deepEqual(await svc.handleCallback(store, { state, code: 'GOOD' }, browserOf(url)), { ok: false, reason: 'invalid_state' });
});

test('callback：在不是發起授權的瀏覽器完成（沒有或不同的綁定 cookie）→ 拒絕，state 作廢', async () => {
  const { url } = await svc.startConnect(store, actor);
  const state = stateFrom(url);
  assert.deepEqual(await svc.handleCallback(store, { state, code: 'GOOD' }, undefined), { ok: false, reason: 'invalid_state' });
  // 就算之後拿到正確 cookie，state 也已作廢，不能再換到粉專權杖
  assert.deepEqual(await svc.handleCallback(store, { state, code: 'GOOD' }, browserOf(url)), { ok: false, reason: 'invalid_state' });
  const other = stateFrom((await svc.startConnect(store, actor)).url);
  assert.deepEqual(
    await svc.handleCallback(store, { state: other, code: 'GOOD' }, svc.stateBinding('another-browser-state')),
    { ok: false, reason: 'invalid_state' },
  );
});

test('callback：code 換不到 token → exchange_failed', async () => {
  const { url } = await svc.startConnect(store, actor);
  assert.deepEqual(await svc.handleCallback(store, { state: stateFrom(url), code: 'BAD' }, browserOf(url)), { ok: false, reason: 'exchange_failed' });
});

let connectId = '';
test('callback 成功：state 只能用一次；暫存內容加密、不含明文 token', async () => {
  const { url } = await svc.startConnect(store, actor);
  const state = stateFrom(url);
  const r = await svc.handleCallback(store, { state, code: 'GOOD' }, browserOf(url));
  assert.equal(r.ok, true);
  connectId = (r as { connectId: string }).connectId;
  assert.deepEqual(await svc.handleCallback(store, { state, code: 'GOOD' }, browserOf(url)), { ok: false, reason: 'invalid_state' }, 'state 重用要被拒');
  const raw = await store.get(`metaconnect:session:${connectId}`);
  assert.ok(raw && !raw.includes('page-token-'), '暫存要加密，不可有明文 page token');
});

test('pages：只回名稱與頭像，不含 token；其他人讀不到', async () => {
  const pages = await svc.listConnectablePages(db, store, connectId, actor);
  assert.equal(pages.length, 5, '要跟著分頁取完（第一頁 4 個＋第二頁 1 個）');
  assert.ok(pages.some((p) => p.id === PAGE_P2));
  assert.ok(!JSON.stringify(pages).includes('page-token-'), '不可回傳 token');
  assert.deepEqual(Object.keys(pages[0]!).sort(), ['id', 'linkedInThisTenant', 'name', 'pictureUrl']);
  await assert.rejects(
    svc.listConnectablePages(db, store, connectId, { tenantId: T_A, agentId: OTHER_AGENT }),
    (e: { code?: string }) => e.code === 'META_CONNECT_SESSION_INVALID',
  );
  await assert.rejects(
    svc.listConnectablePages(tenantScopedClient(prisma, tenantB.id), store, connectId, { tenantId: tenantB.id, agentId: AGENT }),
    (e: { code?: string }) => e.code === 'META_CONNECT_SESSION_INVALID',
  );
});

test('connect：成功建立平台模式渠道並訂閱；訂閱失敗回滾；已被連結的不呼叫 Meta', async () => {
  subscribeCalls.length = 0;
  const results = await svc.connectPages(db, store, connectId, actor, [PAGE_OK, PAGE_FAIL, PAGE_TAKEN, PAGE_FALSE]);
  const by = Object.fromEntries(results.map((r) => [r.pageId, r]));

  assert.equal(by[PAGE_OK]!.status, 'connected');
  const ch = await prisma.channel.findFirst({ where: { tenantId: T_A, externalAccountId: PAGE_OK } });
  assert.ok(ch, '應建立渠道');
  assert.equal(ch!.webhookUrl, null, '平台模式不需要渠道自己的回呼網址');
  const creds = decryptCredentials(ch!.credentialsEncrypted);
  assert.equal(creds.connectMode, 'platform');
  assert.equal(creds.pageAccessToken, `page-token-${PAGE_OK}`);
  assert.equal(creds.appSecret, undefined, '平台模式不存 App Secret');
  assert.ok(subscribeCalls.some((c) => c.pageId === PAGE_OK && c.token === `page-token-${PAGE_OK}`));

  assert.equal(by[PAGE_FAIL]!.status, 'failed');
  assert.equal((by[PAGE_FAIL] as { code: string }).code, 'SUBSCRIBE_FAILED');
  assert.equal(await prisma.channel.count({ where: { externalAccountId: PAGE_FAIL } }), 0, '訂閱失敗不可留下渠道');

  assert.equal((by[PAGE_TAKEN] as { code: string }).code, 'CHANNEL_ACCOUNT_ALREADY_LINKED');
  assert.ok(!subscribeCalls.some((c) => c.pageId === PAGE_TAKEN), '已被連結的粉專不可對 Meta 做任何呼叫');

  assert.equal((by[PAGE_FALSE] as { code: string }).code, 'SUBSCRIBE_FAILED', 'Meta 回 success:false 也算訂閱失敗');
  assert.equal(await prisma.channel.count({ where: { externalAccountId: PAGE_FALSE } }), 0);

  // 連結後的驗證成功：寫入導流識別與最後驗證時間
  assert.ok(ch!.lastVerifiedAt, '連結後應完成驗證');
  assert.ok(((ch!.settings ?? {}) as Record<string, unknown>).bindingHandleAuto, '連結後應取得導流識別');
});

test('connect 有失敗時 session 保留，可在同一次授權重試', async () => {
  failSubscribeFor = new Set();
  const results = await svc.connectPages(db, store, connectId, actor, [PAGE_FAIL, PAGE_P2]);
  assert.deepEqual(results.map((r) => r.status), ['connected', 'connected']);
});

const signed = (pageId: string, psid: string, secret = 'ci-platform-secret') => {
  const raw = Buffer.from(JSON.stringify({
    object: 'page',
    entry: [{ id: pageId, messaging: [{ sender: { id: psid }, recipient: { id: pageId }, timestamp: Date.now(), message: { mid: `m-${psid}-${Math.random()}`, text: 'hi' } }] }],
  }));
  return { raw, headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}` } };
};

test('平台 webhook：平台模式渠道的事件依 entry.id 落地', async () => {
  const psid = `PSID_PLAT_${stamp}`;
  const p = signed(PAGE_OK, psid);
  await processPlatformMetaWebhook(prisma, io, p.raw, p.headers);
  const ch = await prisma.channel.findFirst({ where: { externalAccountId: PAGE_OK }, select: { id: true } });
  assert.equal(await prisma.channelIdentity.count({ where: { channelId: ch!.id, uid: psid } }), 1);
});

test('平台 webhook：自備 App 的渠道（非平台模式）不收平台事件', async () => {
  const psid = `PSID_OWN_${stamp}`;
  const p = signed(PAGE_TAKEN, psid);
  await processPlatformMetaWebhook(prisma, io, p.raw, p.headers);
  assert.equal(await prisma.channelIdentity.count({ where: { uid: psid } }), 0);
});

test('平台 webhook：平台模式渠道停用後，事件丟棄', async () => {
  const ch = await prisma.channel.findFirst({ where: { externalAccountId: PAGE_P2 } });
  assert.ok(ch, '需要一個平台模式渠道');
  // 模擬停用前沒清空帳號 ID 的舊資料：直接把 isActive 改成 false
  await prisma.channel.update({ where: { id: ch!.id }, data: { isActive: false } });
  const psid = `PSID_OFF_${stamp}`;
  const p = signed(PAGE_P2, psid);
  await processPlatformMetaWebhook(prisma, io, p.raw, p.headers);
  assert.equal(await prisma.channelIdentity.count({ where: { uid: psid } }), 0);
});

test('刪除平台模式渠道：取消粉專對平台 App 的訂閱', async () => {
  const { deleteChannel } = await import('#src/modules/channel/channel.service.js');
  const ch = await prisma.channel.findFirst({ where: { externalAccountId: PAGE_P2 } });
  await deleteChannel(db, ch!.id, T_A);
  assert.ok(unsubscribeCalls.includes(PAGE_P2));
});

test('平台 webhook：簽章不是平台 secret → 拒絕', async () => {
  const psid = `PSID_BADSIG_${stamp}`;
  const p = signed(PAGE_OK, psid, 'not-platform-secret');
  await assert.rejects(processPlatformMetaWebhook(prisma, io, p.raw, p.headers));
  assert.equal(await prisma.channelIdentity.count({ where: { uid: psid } }), 0);
});

test('自備 App 的網址 webhook 不能灌事件進平台模式渠道（沒有 App Secret 可比對）', async () => {
  const { processWebhookEvent } = await import('#src/modules/webhook/webhook.service.js');
  const own = await prisma.channel.findFirst({ where: { externalAccountId: PAGE_TAKEN }, select: { id: true } });
  const psid = `PSID_CROSS_${stamp}`;
  const p = signed(PAGE_OK, psid, 'y'); // PAGE_TAKEN 渠道的 appSecret
  await processWebhookEvent(prisma, io, own!.id, 'FB', p.raw, p.headers);
  assert.equal(await prisma.channelIdentity.count({ where: { uid: psid } }), 0);
});

afterAll(async () => {
  for (const fn of cleanup) await fn().catch((err) => console.error('清理失敗', err));
  await prisma.$disconnect();
});
