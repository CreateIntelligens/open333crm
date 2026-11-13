/**
 * Meta 連結流程與留言接收的訂閱欄位（change add-comment-keyword-private-reply tasks 7.5，design D19；
 * spec comment-reply-meta-subscription「重新連結粉專時保留留言欄位」「連結流程可以回到留言自動私訊頁」）。
 *
 * `POST /{page-id}/subscribed_apps` 是整份取代：少帶一個私訊欄位就是整個粉專的私訊中斷。
 * 欄位一律以本檔的字面清單比對，不引用 meta-connect 的 BASE_SUBSCRIBED_FIELDS——常數被改錯時（例如少了
 * message_echoes），引用常數的斷言會跟著錯而照樣通過。
 *
 * 走真實的 meta-connect.service／routes、FB 外掛的 subscribeFields、測試資料庫；Graph API 以 fake-meta-graph 取代，
 * Redis 以記憶體 store 取代。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';

process.env.META_APP_ID = 'ci-cr-connect-app';
process.env.META_APP_SECRET = 'ci-cr-connect-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'ci-cr-connect-verify';
process.env.META_CONNECT_REDIRECT_URI = 'https://crm.example.test/api/v1/meta-connect/callback';
process.env.WEB_BASE_URL = 'https://crm.example.test';

const Fastify = (await import('fastify')).default;
const cookie = (await import('@fastify/cookie')).default;
const { PrismaClient } = await import('@prisma/client');
const { fbPlugin, registerChannelPlugin } = await import('@open333crm/channel-plugins');
const { loadEnvConfig } = await import('#src/config/env.js');
const { tenantScopedClient } = await import('#src/lib/tenant-db.js');
const svc = await import('#src/modules/meta-connect/meta-connect.service.js');
const metaConnectRoutes = (await import('#src/modules/meta-connect/meta-connect.routes.js')).default;
const errorHandlerPlugin = (await import('#src/plugins/error-handler.plugin.js')).default;
const { memBindingStore } = await import('#tests/support/mem-binding-store.js');
const { useFakeMetaGraph } = await import('#tests/support/fake-meta-graph.js');
const { createCommentReplyFixtures } = await import('#tests/support/comment-reply-fixtures.js');
const { restorePlatformSettings, setPlatformCapabilities } = await import('#tests/support/comment-reply-app.js');
const { encryptCredentials } = await import('#src/modules/channel/channel.service.js');

loadEnvConfig();
registerChannelPlugin(fbPlugin);
const prisma = new PrismaClient();
const fx = createCommentReplyFixtures(prisma);
const graph = useFakeMetaGraph();
const apps: Array<{ close: () => Promise<unknown> }> = [];

/** 字面清單（理由見檔頭）：4 個私訊欄位；留言接收另加 feed */
const MESSAGING_FIELDS = ['message_echoes', 'messages', 'messaging_postbacks', 'messaging_referrals'];
const WITH_FEED = ['feed', 'message_echoes', 'messages', 'messaging_postbacks', 'messaging_referrals'];

const stamp = Date.now();
const pageId = (n: number) => `9${stamp}${n}`;
let pages: string[] = [];

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await restorePlatformSettings(prisma);
  await fx.cleanup(async (tenantIds) => {
    await prisma.agentChannelAccess.deleteMany({ where: { channel: { tenantId: { in: tenantIds } } } });
  });
  await prisma.$disconnect();
});

/** OAuth、粉專清單、訂閱與連結後驗證的假 Graph API；pages 是這次授權拿到的粉專 */
beforeEach(async () => {
  await setPlatformCapabilities(prisma, {});
  graph.on('GET', 'graph.facebook.com', /.*/, { body: {} });
  graph.on('POST', 'graph.facebook.com', /^\/v21\.0\/\d+\/subscribed_apps$/, { body: { success: true } });
  graph.on('GET', 'graph.facebook.com', '/v21.0/oauth/access_token', (call) => ({
    body: { access_token: call.query.code === 'GOOD' ? 'short-user-token' : 'long-user-token' },
  }));
  graph.on('GET', 'graph.facebook.com', '/v21.0/me/accounts', () => ({
    body: { data: pages.map((id) => ({ id, name: `CI 留言連結 ${id}`, access_token: `page-token-${id}` })) },
  }));
});

const subscribedFieldsFor = (id: string) => {
  const calls = graph.calls('POST', `/v21.0/${id}/subscribed_apps`);
  assert.equal(calls.length, 1, `${id} 應訂閱一次`);
  return String(calls[0].body?.subscribed_fields).split(',').sort();
};

async function connect(tenantId: string, agentId: string, ids: string[]) {
  pages = ids;
  const store = memBindingStore();
  const actor = { tenantId, agentId };
  const { url } = await svc.startConnect(store, actor);
  const state = new URL(url).searchParams.get('state')!;
  const cb = await svc.handleCallback(store, { state, code: 'GOOD' }, svc.stateBinding(state));
  assert.ok(cb.ok, JSON.stringify(cb));
  return svc.connectPages(tenantScopedClient(prisma, tenantId), store, cb.connectId, actor, ids);
}

const withFeature = await fx.tenant({ plan: { features: ['comment_reply', 'channels', 'inbox', 'core'] } });
const withoutFeature = await fx.tenant({ plan: { features: ['channels', 'inbox', 'core'] } });
const roleA = await fx.role(withFeature.id, ['channel.view', 'channel.create']);
const roleB = await fx.role(withoutFeature.id, ['channel.view', 'channel.create']);
const agentA = await fx.agent(withFeature.id, roleA.id);
const agentB = await fx.agent(withoutFeature.id, roleB.id);

/** 本租戶既有的平台模式渠道（重新連結用） */
const platformChannel = (tenantId: string, id: string, settings: Record<string, unknown>) =>
  prisma.channel.create({
    data: {
      tenantId,
      channelType: 'FB',
      displayName: `${fx.mark} 既有 ${id}`,
      externalAccountId: id,
      credentialsEncrypted: encryptCredentials({ connectMode: 'platform', pageId: id, pageAccessToken: 'old-token' }),
      settings: settings as object,
    },
  });

describe('重新連結粉專時保留留言欄位', () => {
  test('已開啟接收的粉專重新連結：subscribed_fields 含 feed 與 4 個私訊欄位', async () => {
    const id = pageId(1);
    await platformChannel(withFeature.id, id, { commentReply: { receiving: true } });
    const [r] = await connect(withFeature.id, agentA.id, [id]);
    assert.equal(r.status, 'reconnected', JSON.stringify(r));
    assert.deepEqual(subscribedFieldsFor(id), WITH_FEED);
  });

  test('未開啟接收的粉專重新連結：subscribed_fields 恰好是 4 個私訊欄位', async () => {
    const id = pageId(2);
    await platformChannel(withFeature.id, id, {});
    // 平台把 FB 私訊能力關閉時，重新連結也不可因「新連結預設」而加上 feed
    await setPlatformCapabilities(prisma, {});
    const [r] = await connect(withFeature.id, agentA.id, [id]);
    assert.equal(r.status, 'reconnected', JSON.stringify(r));
    assert.deepEqual(subscribedFieldsFor(id), MESSAGING_FIELDS);
  });

  test('方案不含功能時新連結：恰好 4 個私訊欄位，渠道未開啟接收', async () => {
    const id = pageId(3);
    const [r] = await connect(withoutFeature.id, agentB.id, [id]);
    assert.equal(r.status, 'connected', JSON.stringify(r));
    assert.deepEqual(subscribedFieldsFor(id), MESSAGING_FIELDS);
    const ch = await prisma.channel.findFirstOrThrow({ where: { tenantId: withoutFeature.id, externalAccountId: id } });
    assert.notEqual((ch.settings as Record<string, any>).commentReply?.receiving, true);
  });

  test('方案含功能且平台開放 FB 私訊時新連結：訂 feed，渠道開啟接收', async () => {
    const id = pageId(4);
    const [r] = await connect(withFeature.id, agentA.id, [id]);
    assert.equal(r.status, 'connected', JSON.stringify(r));
    assert.deepEqual(subscribedFieldsFor(id), WITH_FEED);
    const ch = await prisma.channel.findFirstOrThrow({ where: { tenantId: withFeature.id, externalAccountId: id } });
    const cr = (ch.settings as Record<string, any>).commentReply;
    assert.equal(cr.receiving, true);
    assert.deepEqual([...cr.subscription.fields].sort(), WITH_FEED);
  });

  test('方案含功能但平台未開放 FB 私訊時新連結：不訂 feed', async () => {
    await setPlatformCapabilities(prisma, { fbPrivateReply: false });
    const id = pageId(5);
    await connect(withFeature.id, agentA.id, [id]);
    assert.deepEqual(subscribedFieldsFor(id), MESSAGING_FIELDS);
  });
});

describe('連結流程可以回到留言自動私訊頁', () => {
  async function buildApp() {
    const store = memBindingStore();
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(cookie);
    app.decorate('prisma', prisma);
    app.decorate('prismaAdmin', prisma);
    app.decorate('authenticate', async (request: any) => {
      request.agent = { id: agentA.id, tenantId: withFeature.id, role: 'AGENT', roleId: roleA.id };
      request.tenantPrisma = tenantScopedClient(prisma, withFeature.id);
    });
    await app.register(metaConnectRoutes, { prefix: '/api/v1/meta-connect', store });
    await app.ready();
    apps.push(app);
    return app;
  }

  test('站內路徑：連結完成後導回 /dashboard/comment-replies（callback 帶給渠道頁）', async () => {
    pages = [pageId(6)];
    const app = await buildApp();
    const start = await app.inject({ method: 'POST', url: '/api/v1/meta-connect/start', payload: { returnTo: '/dashboard/comment-replies' } });
    assert.equal(start.statusCode, 200, start.body);
    const state = new URL(start.json().data.url).searchParams.get('state')!;
    const binding = start.cookies.find((c) => c.name === 'metaConnectState')!.value;
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/meta-connect/callback?code=GOOD&state=${encodeURIComponent(state)}`,
      cookies: { metaConnectState: binding },
    });
    assert.equal(cb.statusCode, 302, cb.body);
    const location = new URL(String(cb.headers.location));
    assert.equal(location.pathname, '/dashboard/settings/channels');
    assert.ok(location.searchParams.get('metaConnect'));
    assert.equal(location.searchParams.get('returnTo'), '/dashboard/comment-replies');
  });

  test('外部網址：https://evil.example 與 //evil.example 回 400', async () => {
    const app = await buildApp();
    for (const returnTo of ['https://evil.example', '//evil.example', '/dashboard//evil.example', '/settings', '/dashboard/\\evil']) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/meta-connect/start', payload: { returnTo } });
      assert.equal(res.statusCode, 400, `${returnTo}：${res.body}`);
    }
  });
});
