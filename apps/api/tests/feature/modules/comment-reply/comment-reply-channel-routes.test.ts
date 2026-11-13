/**
 * 留言自動私訊的渠道端 API（change add-comment-keyword-private-reply tasks 7.4；spec comment-reply-meta-subscription
 * 「前置條件查詢」「開啟留言接收時送出完整的訂閱欄位」「關閉留言接收」「最近貼文清單」「以網址找貼文只呼叫 Graph API」、
 * comment-reply-platform-controls「沒有設定時的預設」「測試階段旗標」）。
 *
 * 走真實的 comment-reply-channel.routes、正式的 FB／IG 外掛與 app_tenant 連線；Graph API 以 fake-meta-graph 取代
 * （白名單外的 host 讓測試失敗）。訂閱欄位以一份字面清單比對（不引用程式內的常數，常數被改錯時測試才抓得到）。
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, test } from 'vitest';

process.env.META_APP_ID = 'ci-cr-platform-app';
process.env.META_APP_SECRET = 'ci-cr-platform-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'ci-cr-verify';
process.env.META_CONNECT_REDIRECT_URI = 'https://crm.example.test/api/v1/meta-connect/callback';

const { Redis } = await import('ioredis');
const { PrismaClient } = await import('@prisma/client');
const { loadEnvConfig } = await import('#src/config/env.js');
const { taipeiMonthString } = await import('@open333crm/core');
const { urls } = await import('#tests/setup/feature-config.js');
const { createCommentReplyFixtures } = await import('#tests/support/comment-reply-fixtures.js');
const { createCommentReplyRecords } = await import('#tests/support/comment-reply-records.js');
const { useFakeMetaGraph } = await import('#tests/support/fake-meta-graph.js');
const { BASE, buildCommentReplyApp, MANAGE, restorePlatformSettings, setPlatformCapabilities, setPlatformSetting, VIEW } = await import(
  '#tests/support/comment-reply-app.js'
);
const { COMMENT_REPLY_SETTING_KEYS } = await import('#src/modules/comment-reply/comment-reply-platform-settings.js');

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: urls.tenant } } });
const redis = new Redis(process.env.REDIS_URL!);
const fx = createCommentReplyFixtures(owner);
const rec = createCommentReplyRecords(owner);
const graph = useFakeMetaGraph();
const apps: Array<{ close: () => Promise<unknown> }> = [];

/** 字面清單：私訊 4 欄位（與 meta-connect 的常數分開寫，常數被改錯時這裡才抓得到） */
const MESSAGING = ['messages', 'messaging_postbacks', 'messaging_referrals', 'message_echoes'];
const sorted = (list: string[]) => [...list].sort();

const tenant = await fx.tenant({ plan: { features: ['comment_reply', 'channels', 'inbox', 'core'], limits: { monthlyCommentReplies: 100, maxCommentReplyRules: 5 } } });
const T = tenant.id;
const id = (n: number) => `${Date.now()}${n}`;
const fbPlatform = await fx.fbChannel(T, { mode: 'platform', externalAccountId: id(1) });
const fbOwn = await fx.fbChannel(T, { mode: 'own_app', externalAccountId: id(2), appSecret: 'own-app-secret', appId: 'own-app-id' });
const ig = await fx.igChannel(T, { externalAccountId: id(3) });

const adminRole = await fx.role(T, [VIEW, MANAGE, 'channel.view', 'channel.view_all', 'channel.update']);
const branchRole = await fx.role(T, [VIEW, MANAGE, 'channel.view', 'channel.update']);
const viewOnlyRole = await fx.role(T, [VIEW, 'channel.view', 'channel.view_all']);
const appOf = async (roleId: string, channels?: Array<{ channelId: string }>) => {
  const agent = await fx.agent(T, roleId, { channels });
  const app = await buildCommentReplyApp({ owner, tenantDb, redis }, { id: agent.id, tenantId: T, roleId });
  apps.push(app);
  return app;
};
const adminApp = await appOf(adminRole.id);
const branchApp = await appOf(branchRole.id, [{ channelId: fbPlatform.id }]);
const viewOnlyApp = await appOf(viewOnlyRole.id);

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await restorePlatformSettings(owner);
  await fx.cleanup(rec.cleanup);
  await redis.quit();
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

/** 每個測試：平台能力全開、清掉 readiness／貼文快取、Graph API 的訂閱查詢回「已訂閱 feed」 */
beforeEach(async () => {
  await restorePlatformSettings(owner);
  await setPlatformCapabilities(owner, {});
  const keys = await redis.keys('cr:*');
  if (keys.length) await redis.del(...keys);
  graph.on('GET', 'graph.facebook.com', /^\/v21\.0\/\d+\/subscribed_apps$/, { body: { data: [{ id: 'ci-cr-platform-app', subscribed_fields: [...MESSAGING, 'feed'] }] } });
  graph.on('GET', 'graph.facebook.com', '/v21.0/debug_token', { body: { data: { scopes: ['pages_show_list', 'pages_manage_metadata', 'pages_messaging', 'pages_manage_engagement', 'pages_read_engagement'] } } });
  graph.on('GET', 'graph.instagram.com', '/v21.0/me/subscribed_apps', { body: { data: [{ subscribed_fields: ['messages', 'comments'] }] } });
});

const readiness = async (app = adminApp) => {
  const res = await app.inject({ method: 'GET', url: `${BASE}/readiness` });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().data;
};
const channelOf = (data: { channels: Array<{ channelId: string }> }, channelId: string) =>
  data.channels.find((c) => c.channelId === channelId) as Record<string, any>;

describe('前置條件查詢', () => {
  test('用量與上限：{ monthlyUsed: 12, monthlyLimit: 100, activeRules: 3, maxRules: 5 }', async () => {
    await owner.commentReplyUsage.create({ data: { tenantId: T, month: taipeiMonthString(new Date()), sentCount: 12 } });
    for (let i = 0; i < 3; i++) await rec.rule(T, fbPlatform.id);
    await rec.rule(T, fbPlatform.id, { isActive: false });
    const data = await readiness();
    assert.deepEqual(data.quota, { monthlyUsed: 12, monthlyLimit: 100, activeRules: 3, maxRules: 5 });
  });

  test('Meta 回應很慢：3 秒多一點內回應，該渠道 subscribed 是 null', async () => {
    graph.on('GET', 'graph.facebook.com', /^\/v21\.0\/\d+\/subscribed_apps$/, { delayMs: 5000, body: { data: [] } });
    const started = Date.now();
    const data = await readiness();
    assert.ok(Date.now() - started < 4500, `readiness 花了 ${Date.now() - started}ms`);
    assert.equal(channelOf(data, fbPlatform.id).subscribed, null);
    assert.equal(channelOf(data, ig.id).subscribed, true);
  });

  test('自備 App 的渠道：appMode 是 own_app；平台連結的是 platform；IG 是 own_app', async () => {
    const data = await readiness();
    assert.equal(channelOf(data, fbOwn.id).appMode, 'own_app');
    assert.equal(channelOf(data, fbPlatform.id).appMode, 'platform');
    assert.equal(channelOf(data, ig.id).appMode, 'own_app');
  });

  test('只列看得到的渠道', async () => {
    const data = await readiness(branchApp);
    assert.deepEqual(data.channels.map((c: { channelId: string }) => c.channelId), [fbPlatform.id]);
  });

  test('沒有設定時的預設：能力全關、測試階段開、未緊急停止', async () => {
    await restorePlatformSettings(owner);
    const data = await readiness();
    assert.ok(Object.values(data.capabilities).every((v) => v === false));
    assert.deepEqual(data.testPhase, { fb: true, ig: true });
    assert.equal(data.emergencyStopped, false);
  });

  test('關閉測試階段：readiness 回 testPhase.fb 為 false', async () => {
    await setPlatformSetting(owner, COMMENT_REPLY_SETTING_KEYS.testPhase, { fb: false, ig: true });
    const data = await readiness();
    assert.deepEqual(data.testPhase, { fb: false, ig: true });
  });

  test('IG 近 24 小時有權限不足的失敗：missingPermissions 含留言權限', async () => {
    const rule = await rec.rule(T, ig.id);
    const author = await rec.author(T, ig.id);
    await rec.log(T, ig.id, rule.id, author.id, { status: 'FAILED', reasonCode: 'PERMISSION_MISSING' });
    const data = await readiness();
    assert.deepEqual(channelOf(data, ig.id).missingPermissions, ['instagram_business_manage_comments']);
  });
});

describe('開啟與關閉留言接收', () => {
  const subscribe = (app: typeof adminApp, channelId: string, method: 'POST' | 'DELETE' = 'POST') =>
    app.inject({ method, url: `${BASE}/channels/${channelId}/subscribe-comments` });
  const fbSubscribeCalls = () => graph.calls('POST', /^\/v21\.0\/\d+\/subscribed_apps$/, 'graph.facebook.com');

  test('FB 開啟留言接收：subscribed_fields 恰好是 4 個私訊欄位加 feed；下一次 readiness 顯示已開啟', async () => {
    graph.on('POST', 'graph.facebook.com', `/v21.0/${fbPlatform.externalAccountId}/subscribed_apps`, { body: { success: true } });
    const res = await subscribe(adminApp, fbPlatform.id);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data, { receiving: true });
    const calls = fbSubscribeCalls();
    assert.equal(calls.length, 1);
    assert.deepEqual(sorted(String(calls[0].body?.subscribed_fields).split(',')), sorted([...MESSAGING, 'feed']));
    // 平台模式：appsecret_proof 用平台 App Secret
    const token = String(fbPlatform.credentials.pageAccessToken);
    assert.equal(calls[0].body?.appsecret_proof, createHmac('sha256', 'ci-cr-platform-secret').update(token).digest('hex'));
    assert.equal(channelOf(await readiness(), fbPlatform.id).receiving, true);
  });

  test('IG 開啟留言接收：POST graph.instagram.com/.../me/subscribed_apps，欄位含 messages 與 comments', async () => {
    graph.on('POST', 'graph.instagram.com', '/v21.0/me/subscribed_apps', { body: { success: true } });
    const res = await subscribe(adminApp, ig.id);
    assert.equal(res.statusCode, 200, res.body);
    const calls = graph.calls('POST', '/v21.0/me/subscribed_apps', 'graph.instagram.com');
    assert.equal(calls.length, 1);
    const fields = String(calls[0].query.subscribed_fields).split(',');
    assert.ok(fields.includes('messages') && fields.includes('comments'), fields.join(','));
  });

  test('自備 App 的渠道用自己的密鑰：appsecret_proof 以渠道權杖與 App Secret 計算', async () => {
    graph.on('POST', 'graph.facebook.com', `/v21.0/${fbOwn.externalAccountId}/subscribed_apps`, { body: { success: true } });
    const res = await subscribe(adminApp, fbOwn.id);
    assert.equal(res.statusCode, 200, res.body);
    const token = String(fbOwn.credentials.pageAccessToken);
    assert.equal(fbSubscribeCalls()[0].body?.appsecret_proof, createHmac('sha256', 'own-app-secret').update(token).digest('hex'));
  });

  test('缺渠道修改權限：403，details.requiredPermission 是 channel.update', async () => {
    const res = await subscribe(viewOnlyApp, fbPlatform.id);
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.details.requiredPermission, 'channel.update');
    assert.equal(fbSubscribeCalls().length, 0);
  });

  test('Meta 回權限錯誤：409 REAUTH_REQUIRED，渠道仍是未開啟', async () => {
    const ch = await fx.fbChannel(T, { externalAccountId: id(11) });
    graph.on('POST', 'graph.facebook.com', `/v21.0/${ch.externalAccountId}/subscribed_apps`, { status: 403, body: { error: { code: 200, message: 'Permissions error' } } });
    const res = await subscribe(adminApp, ch.id);
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'REAUTH_REQUIRED');
    const row = await owner.channel.findUniqueOrThrow({ where: { id: ch.id } });
    assert.notEqual((row.settings as Record<string, any>).commentReply?.receiving, true);
  });

  test('Meta 回其他錯誤：HTTP 500 → 502 SUBSCRIBE_FAILED，渠道仍是未開啟', async () => {
    const ch = await fx.fbChannel(T, { externalAccountId: id(12) });
    graph.on('POST', 'graph.facebook.com', `/v21.0/${ch.externalAccountId}/subscribed_apps`, { status: 500, body: { error: { message: 'boom' } } });
    const res = await subscribe(adminApp, ch.id);
    assert.equal(res.statusCode, 502, res.body);
    assert.equal(res.json().error.code, 'SUBSCRIBE_FAILED');
    const row = await owner.channel.findUniqueOrThrow({ where: { id: ch.id } });
    assert.notEqual((row.settings as Record<string, any>).commentReply?.receiving, true);
  });

  test('關閉後只剩私訊欄位：subscribed_fields 恰好是 4 個私訊欄位', async () => {
    const ch = await fx.fbChannel(T, { externalAccountId: id(13), settings: { commentReply: { receiving: true, lastCommentEventAt: '2026-11-01T00:00:00.000Z' } } });
    graph.on('POST', 'graph.facebook.com', `/v21.0/${ch.externalAccountId}/subscribed_apps`, { body: { success: true } });
    const res = await subscribe(adminApp, ch.id, 'DELETE');
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data, { receiving: false });
    assert.deepEqual(sorted(String(fbSubscribeCalls()[0].body?.subscribed_fields).split(',')), sorted(MESSAGING));
    const settings = (await owner.channel.findUniqueOrThrow({ where: { id: ch.id } })).settings as Record<string, any>;
    assert.equal(settings.commentReply.receiving, false);
    assert.equal(settings.commentReply.lastCommentEventAt, '2026-11-01T00:00:00.000Z', '其他子鍵保留');
  });
});

describe('最近貼文與網址解析', () => {
  test('權杖失效：Graph code 190 → 502 POSTS_UNAVAILABLE，details.reason 是 TOKEN_EXPIRED', async () => {
    graph.on('GET', 'graph.facebook.com', `/v21.0/${fbPlatform.externalAccountId}/published_posts`, { status: 400, body: { error: { code: 190, message: 'expired' } } });
    const res = await adminApp.inject({ method: 'GET', url: `${BASE}/channels/${fbPlatform.id}/posts` });
    assert.equal(res.statusCode, 502, res.body);
    assert.equal(res.json().error.code, 'POSTS_UNAVAILABLE');
    assert.equal(res.json().error.details.reason, 'TOKEN_EXPIRED');
  });

  test('最近貼文：回傳貼文與下一頁 cursor，60 秒內第二次不再呼叫 Graph API', async () => {
    graph.on('GET', 'graph.facebook.com', `/v21.0/${fbPlatform.externalAccountId}/published_posts`, {
      body: {
        data: [{ id: `${fbPlatform.externalAccountId}_55`, message: '雙十一', created_time: '2026-11-11T00:00:00+0000', permalink_url: 'https://www.facebook.com/x/posts/55' }],
        paging: { cursors: { after: 'NEXT' }, next: 'https://graph.facebook.com/next' },
      },
    });
    const first = await adminApp.inject({ method: 'GET', url: `${BASE}/channels/${fbPlatform.id}/posts` });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().data.posts[0].postId, `${fbPlatform.externalAccountId}_55`);
    assert.equal(first.json().data.nextCursor, 'NEXT');
    await adminApp.inject({ method: 'GET', url: `${BASE}/channels/${fbPlatform.id}/posts` });
    assert.equal(graph.calls('GET', `/v21.0/${fbPlatform.externalAccountId}/published_posts`).length, 1);
  });

  test('平台未開放貼文挑選：403 CAPABILITY_DISABLED，沒有呼叫 Graph API', async () => {
    await setPlatformCapabilities(owner, { fbPostPicker: false });
    const res = await adminApp.inject({ method: 'GET', url: `${BASE}/channels/${fbPlatform.id}/posts` });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.code, 'CAPABILITY_DISABLED');
    assert.equal(res.json().error.details.capability, 'fbPostPicker');
    assert.equal(graph.recorded.length, 0);
  });

  test('解析 FB 貼文網址：回傳 postId 為 {pageId}_123 的貼文', async () => {
    const postId = `${fbPlatform.externalAccountId}_123`;
    graph.on('GET', 'graph.facebook.com', `/v21.0/${postId}`, { body: { message: '貼文內容', created_time: '2026-11-10T00:00:00+0000', permalink_url: 'https://www.facebook.com/p/posts/123' } });
    const res = await adminApp.inject({
      method: 'POST',
      url: `${BASE}/channels/${fbPlatform.id}/posts/resolve`,
      payload: { url: 'https://www.facebook.com/somepage/posts/123' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.postId, postId);
  });

  test('任意外部網址：404 POST_NOT_FOUND；呼叫過的主機只有 Graph API 網域', async () => {
    const res = await adminApp.inject({ method: 'POST', url: `${BASE}/channels/${fbPlatform.id}/posts/resolve`, payload: { url: 'https://evil.example/a' } });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal(res.json().error.code, 'POST_NOT_FOUND');
    assert.ok(graph.recorded.every((c) => c.host === 'graph.facebook.com' || c.host === 'graph.instagram.com'));
    assert.deepEqual(graph.violations, []);
  });

  test('貼文清單需要 manage：只有 view 回 403', async () => {
    const res = await viewOnlyApp.inject({ method: 'GET', url: `${BASE}/channels/${fbPlatform.id}/posts` });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.details.requiredPermission, MANAGE);
  });
});
