/**
 * 留言規則 API（change add-comment-keyword-private-reply tasks 7.1；spec comment-reply-rules、
 * comment-reply-platform-controls「留言自動私訊是方案功能」「平台能力開關由前後端共同遵守」）。
 *
 * 走真實的 comment-reply-rule.routes、requirePermission（角色權限 ∩ 方案天花板）、渠道可見範圍、
 * app_tenant 連線（RLS）與正式的 FB／IG 外掛。每個檔案自建租戶，afterAll 依外鍵順序刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { registerChannelPlugin, threadsPlugin, type ChannelPlugin } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { withTenant } from '#src/lib/tenant-db.js';
import { updatePlan } from '#src/modules/platform/plan.service.js';
import { matchCommentRule } from '#src/modules/comment-reply/comment-reply-match.js';
import { listActiveRulesForChannel } from '#src/modules/comment-reply/comment-reply-rule.service.js';
import { urls } from '#tests/setup/feature-config.js';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { createCommentReplyRecords } from '#tests/support/comment-reply-records.js';
import {
  BASE,
  buildCommentReplyApp,
  MANAGE,
  restorePlatformSettings,
  setPlatformCapabilities,
  VIEW,
} from '#tests/support/comment-reply-app.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: urls.tenant } } });
const redis = new Redis(process.env.REDIS_URL!);
const fx = createCommentReplyFixtures(owner);
const rec = createCommentReplyRecords(owner);
const deps = { owner, tenantDb, redis };
const apps: Array<{ close: () => Promise<unknown> }> = [];

const FEATURES = ['comment_reply', 'channels', 'inbox', 'core'];
const tenant = await fx.tenant({ plan: { features: FEATURES } });
const T = tenant.id;
// 粉專 ID 用數字（與真實粉專相同；parsePostReference 只接受數字的 {pageId}_{postId}）
const numericId = (n: number) => `${Date.now()}${n}`;
const fbA = await fx.fbChannel(T, { externalAccountId: numericId(1) });
const fbB = await fx.fbChannel(T, { externalAccountId: numericId(2) });
const ig = await fx.igChannel(T, { externalAccountId: numericId(3) });
const line = await owner.channel.create({
  data: { tenantId: T, channelType: 'LINE', displayName: `${fx.mark} LINE`, credentialsEncrypted: 'x' },
});

const adminRole = await fx.role(T, [VIEW, MANAGE, 'channel.view', 'channel.view_all']);
const branchRole = await fx.role(T, [VIEW, MANAGE, 'channel.view']);
const viewerRole = await fx.role(T, [VIEW, 'channel.view', 'channel.view_all']);
const admin = await fx.agent(T, adminRole.id);
const branch = await fx.agent(T, branchRole.id, { channels: [{ channelId: fbA.id, accessLevel: 'full' }] });
const readOnly = await fx.agent(T, branchRole.id, { channels: [{ channelId: fbA.id, accessLevel: 'read_only' }] });
const viewer = await fx.agent(T, viewerRole.id);

const appOf = async (a: { id: string; roleId: string | null }, tenantId = T) => {
  const app = await buildCommentReplyApp(deps, { id: a.id, tenantId, roleId: a.roleId });
  apps.push(app);
  return app;
};
const adminApp = await appOf(admin);
const branchApp = await appOf(branch);
const readOnlyApp = await appOf(readOnly);
const viewerApp = await appOf(viewer);

// 其他租戶（素材、規則）
const other = await fx.tenant({ plan: { features: FEATURES } });
const otherFb = await fx.fbChannel(other.id);
const otherRule = await rec.rule(other.id, otherFb.id, { name: '其他租戶的規則' });
const otherMaterial = await owner.material.create({
  data: { tenantId: other.id, name: '其他租戶素材', channelType: 'fb', contentType: 'fb_text', body: { text: 'hi' } },
});

// 本租戶素材
const material = (data: { name: string; contentType: string; channelType?: string; isActive?: boolean; body?: object }) =>
  owner.material.create({
    data: { tenantId: T, channelType: data.channelType ?? 'fb', contentType: data.contentType, name: data.name, isActive: data.isActive ?? true, body: data.body ?? { text: data.name } },
  });
const fbText = await material({ name: 'FB 文字素材', contentType: 'fb_text' });
const fbImage = await material({ name: 'FB 圖片素材', contentType: 'fb_image', body: { url: 'https://cdn.example/a.png' } });
const fbReceipt = await material({ name: 'FB 收據', contentType: 'fb_receipt' });
await material({ name: '停用的 FB 素材', contentType: 'fb_text', isActive: false });
const couponMaterial = await material({ name: '含券連結素材', contentType: 'fb_text', body: { text: '領券 {{coupon.url}}' } });

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await restorePlatformSettings(owner);
  await fx.cleanup(rec.cleanup);
  registerChannelPlugin(threadsPlugin);
  await redis.quit();
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

beforeEach(async () => {
  await setPlatformCapabilities(owner, {});
});

const fbRuleInput = (overrides: Record<string, unknown> = {}) => ({
  channelId: fbA.id,
  name: '+1 領券',
  keywords: ['+1', '領券'],
  matchMode: 'any',
  postScope: 'all',
  posts: [],
  content: { type: 'text', text: '感謝留言' },
  publicReply: { enabled: true, texts: ['已私訊你', '請看私訊', '感謝參加'] },
  ...overrides,
});
const createRule = (app = adminApp, overrides: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `${BASE}/rules`, payload: fbRuleInput(overrides) });

describe('建立留言規則', () => {
  test('建立 FB 文字規則並讀回', async () => {
    const res = await createRule();
    assert.equal(res.statusCode, 201, res.body);
    const created = res.json().data;
    const got = await adminApp.inject({ method: 'GET', url: `${BASE}/rules/${created.id}` });
    assert.equal(got.statusCode, 200, got.body);
    const rule = got.json().data;
    assert.equal(rule.name, '+1 領券');
    assert.equal(rule.channelId, fbA.id);
    assert.deepEqual(rule.keywords, ['+1', '領券']);
    assert.equal(rule.matchMode, 'any');
    assert.equal(rule.postScope, 'all');
    assert.deepEqual(rule.posts, []);
    assert.deepEqual(rule.content, { type: 'text', text: '感謝留言' });
    assert.deepEqual(rule.publicReply, { enabled: true, texts: ['已私訊你', '請看私訊', '感謝參加'] });
    assert.equal(rule.dedupePerCommenter, true);
    assert.equal(rule.isActive, true);
    assert.equal(rule.canEdit, true);
    assert.deepEqual(rule.stats7d, { sent: 0, failed: 0, expired: 0, duplicate: 0 });
  });

  test('選 LINE 渠道：400 CHANNEL_NOT_SUPPORTED，沒有建立規則', async () => {
    const before = await owner.commentReplyRule.count({ where: { tenantId: T } });
    const res = await createRule(adminApp, { channelId: line.id, publicReply: { enabled: false, texts: [] } });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'CHANNEL_NOT_SUPPORTED');
    assert.equal(await owner.commentReplyRule.count({ where: { tenantId: T } }), before);
  });

  test('關鍵字正規化後重複：400，details.field 是 keywords', async () => {
    const res = await createRule(adminApp, { keywords: ['+1', '＋１'] });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.details.field, 'keywords');
  });

  test('指定貼文卻沒有貼文：400，details.field 是 posts', async () => {
    const res = await createRule(adminApp, { postScope: 'selected', posts: [] });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.details.field, 'posts');
  });

  test('沒有 manage 權限：403，details.requiredPermission 是 comment_reply.manage', async () => {
    const res = await createRule(viewerApp);
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.details.requiredPermission, MANAGE);
  });
});

describe('規則私訊內容的限制', () => {
  test('IG 規則選素材：400 MATERIAL_UNSUPPORTED，details.field 是 content', async () => {
    const res = await createRule(adminApp, { channelId: ig.id, content: { type: 'material', materialId: fbText.id }, publicReply: { enabled: false, texts: [] } });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'MATERIAL_UNSUPPORTED');
    assert.equal(res.json().error.details.field, 'content');
  });

  test('選收據範本素材：400 MATERIAL_UNSUPPORTED', async () => {
    const res = await createRule(adminApp, { content: { type: 'material', materialId: fbReceipt.id } });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'MATERIAL_UNSUPPORTED');
  });

  test('其他租戶的素材：400 MATERIAL_NOT_FOUND', async () => {
    const res = await createRule(adminApp, { content: { type: 'material', materialId: otherMaterial.id } });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'MATERIAL_NOT_FOUND');
  });

  test('文字含顧客專屬券連結：400 COUPON_URL_IN_RULE_MESSAGE（文字與素材都擋）', async () => {
    const text = await createRule(adminApp, { content: { type: 'text', text: '領券 {{coupon.url}}' } });
    assert.equal(text.statusCode, 400, text.body);
    assert.equal(text.json().error.code, 'COUPON_URL_IN_RULE_MESSAGE');
    const mat = await createRule(adminApp, { content: { type: 'material', materialId: couponMaterial.id } });
    assert.equal(mat.statusCode, 400, mat.body);
    assert.equal(mat.json().error.code, 'COUPON_URL_IN_RULE_MESSAGE');
  });

  test('FB 規則選圖片素材：201，讀回素材名稱與狀態', async () => {
    const res = await createRule(adminApp, { content: { type: 'material', materialId: fbImage.id } });
    assert.equal(res.statusCode, 201, res.body);
    assert.deepEqual(res.json().data.content, { type: 'material', materialId: fbImage.id, materialName: 'FB 圖片素材', materialStatus: 'ACTIVE' });
  });
});

describe('規則的素材選項', () => {
  test('沒有行銷權限也能選素材：只有啟用中、可私訊的 FB 素材', async () => {
    const res = await adminApp.inject({ method: 'GET', url: `${BASE}/material-options?channelId=${fbA.id}` });
    assert.equal(res.statusCode, 200, res.body);
    const ids = (res.json().data as Array<{ id: string }>).map((m) => m.id);
    assert.ok(ids.includes(fbText.id) && ids.includes(fbImage.id), '要有 FB 文字與圖片素材');
    assert.ok(!ids.includes(fbReceipt.id), '不含 fb_receipt');
    assert.ok(!ids.includes(otherMaterial.id), '不含其他租戶');
    assert.equal((res.json().data as Array<{ name: string }>).some((m) => m.name === '停用的 FB 素材'), false, '不含停用素材');
  });

  test('IG 渠道沒有素材選項：空陣列', async () => {
    const res = await adminApp.inject({ method: 'GET', url: `${BASE}/material-options?channelId=${ig.id}` });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data, []);
  });
});

describe('修改與貼文', () => {
  test('修改時帶渠道：400 CHANNEL_IMMUTABLE，規則的渠道不變', async () => {
    const created = (await createRule()).json().data;
    const res = await adminApp.inject({ method: 'PATCH', url: `${BASE}/rules/${created.id}`, payload: { channelId: fbB.id } });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'CHANNEL_IMMUTABLE');
    assert.equal((await owner.commentReplyRule.findUniqueOrThrow({ where: { id: created.id } })).channelId, fbA.id);
  });

  test('修改只送 postScope=selected、既有沒有貼文：合併後再驗證，400 details.field 是 posts', async () => {
    const created = (await createRule()).json().data;
    const res = await adminApp.inject({ method: 'PATCH', url: `${BASE}/rules/${created.id}`, payload: { postScope: 'selected' } });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.details.field, 'posts');
  });

  test('無法辨識的貼文參照：400 POST_ID_INVALID', async () => {
    const res = await createRule(adminApp, { postScope: 'selected', posts: [{ postId: 'hello' }] });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'POST_ID_INVALID');
    assert.equal(res.json().error.details.field, 'posts.0');
  });

  test('手動輸入的純數字貼文 ID 存成 {pageId}_{id}；讀回的貼文原樣送回 PATCH 也可以', async () => {
    const res = await createRule(adminApp, { postScope: 'selected', posts: [{ postId: '123' }] });
    assert.equal(res.statusCode, 201, res.body);
    const rule = res.json().data;
    assert.deepEqual(rule.posts.map((p: { postId: string }) => p.postId), [`${fbA.externalAccountId}_123`]);
    const patch = await adminApp.inject({ method: 'PATCH', url: `${BASE}/rules/${rule.id}`, payload: { name: '改名', posts: rule.posts } });
    assert.equal(patch.statusCode, 200, patch.body);
    assert.equal(patch.json().data.name, '改名');
  });

  test('沒帶公開回覆：讀回 enabled false、texts 空陣列', async () => {
    const { publicReply: _omit, ...input } = fbRuleInput();
    const res = await adminApp.inject({ method: 'POST', url: `${BASE}/rules`, payload: input });
    assert.equal(res.statusCode, 201, res.body);
    assert.deepEqual(res.json().data.publicReply, { enabled: false, texts: [] });
  });

  test('開啟公開回覆但沒有文字：400 details.field 是 publicReply', async () => {
    const res = await createRule(adminApp, { publicReply: { enabled: true, texts: [] } });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.details.field, 'publicReply');
  });

  test('平台未開放公開回覆：400 CAPABILITY_DISABLED，details.capability 是 fbPublicReply', async () => {
    await setPlatformCapabilities(owner, { fbPublicReply: false });
    const res = await createRule();
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'CAPABILITY_DISABLED');
    assert.equal(res.json().error.details.capability, 'fbPublicReply');
  });

  test('渠道外掛不支援公開回覆：400 PUBLIC_REPLY_NOT_SUPPORTED', async () => {
    const ext = threadsPlugin.extensions.comments;
    const noPublic = Object.create(threadsPlugin) as ChannelPlugin;
    Object.defineProperty(noPublic, 'extensions', {
      value: { comments: { ...ext, parsePostReference: ext.parsePostReference, capabilities: { ...ext.capabilities, publicReply: false } } },
    });
    registerChannelPlugin(noPublic);
    try {
      const res = await createRule(adminApp, { channelId: ig.id });
      assert.equal(res.statusCode, 400, res.body);
      assert.equal(res.json().error.code, 'PUBLIC_REPLY_NOT_SUPPORTED');
      assert.equal(res.json().error.details.field, 'publicReply');
    } finally {
      registerChannelPlugin(threadsPlugin);
    }
  });

  test('IG 私訊尚未開放：403 CAPABILITY_DISABLED，details.capability 是 igPrivateReply', async () => {
    await setPlatformCapabilities(owner, { igPrivateReply: false });
    const res = await createRule(adminApp, { channelId: ig.id, publicReply: { enabled: false, texts: [] } });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.code, 'CAPABILITY_DISABLED');
    assert.equal(res.json().error.details.capability, 'igPrivateReply');
  });
});

describe('排序與試算', () => {
  test('排序清單少一條：409 RULE_ORDER_MISMATCH，順序不變；ids 重複 400', async () => {
    const list = (await adminApp.inject({ method: 'GET', url: `${BASE}/rules` })).json().data as Array<{ id: string; priority: number }>;
    assert.ok(list.length >= 2);
    const before = await owner.commentReplyRule.findMany({ where: { tenantId: T }, select: { id: true, priority: true }, orderBy: { id: 'asc' } });
    const res = await adminApp.inject({ method: 'PUT', url: `${BASE}/rules/order`, payload: { ids: list.slice(1).map((r) => r.id) } });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'RULE_ORDER_MISMATCH');
    const after = await owner.commentReplyRule.findMany({ where: { tenantId: T }, select: { id: true, priority: true }, orderBy: { id: 'asc' } });
    assert.deepEqual(after, before);

    const dup = await adminApp.inject({ method: 'PUT', url: `${BASE}/rules/order`, payload: { ids: [list[0].id, list[0].id] } });
    assert.equal(dup.statusCode, 400, dup.body);
  });

  test('調整順序：把最後一條排到最前，讀回的 priority 依新順序', async () => {
    const list = (await adminApp.inject({ method: 'GET', url: `${BASE}/rules` })).json().data as Array<{ id: string }>;
    const ids = [list[list.length - 1].id, ...list.slice(0, -1).map((r) => r.id)];
    const res = await adminApp.inject({ method: 'PUT', url: `${BASE}/rules/order`, payload: { ids } });
    assert.equal(res.statusCode, 200, res.body);
    const again = (await adminApp.inject({ method: 'GET', url: `${BASE}/rules` })).json().data as Array<{ id: string }>;
    assert.deepEqual(again.map((r) => r.id), ids);
  });

  test('試算與收件結果相同：回傳的規則等於收件用的規則來源＋matchCommentRule 的結果，且不產生紀錄', async () => {
    const first = (await createRule(adminApp, { name: '試算 A', keywords: ['試算關鍵字'], publicReply: { enabled: false, texts: [] } })).json().data;
    await createRule(adminApp, { name: '試算 B', keywords: ['試算關鍵字'], publicReply: { enabled: false, texts: [] } });
    const logsBefore = await owner.commentReplyLog.count({ where: { tenantId: T } });
    const res = await viewerApp.inject({ method: 'POST', url: `${BASE}/rules/test`, payload: { channelId: fbA.id, postId: '999', text: '我要試算關鍵字！' } });
    assert.equal(res.statusCode, 200, res.body);
    const intake = await withTenant(tenantDb, T, async (tx) => {
      const rules = await listActiveRulesForChannel({ tx, tenantId: T }, fbA.id);
      return matchCommentRule(rules as never, { channelId: fbA.id, postId: `${fbA.externalAccountId}_999`, text: '我要試算關鍵字！' });
    });
    assert.equal(res.json().data.matched, true);
    assert.equal(res.json().data.ruleId, intake?.rule.id);
    assert.equal(res.json().data.ruleId, first.id, '同時命中時套用排在前面的規則');
    assert.equal(await owner.commentReplyLog.count({ where: { tenantId: T } }), logsBefore, '試算不產生紀錄');
  });

  test('只有檢視權限試算：200；不會觸發時 matched=false', async () => {
    const res = await viewerApp.inject({ method: 'POST', url: `${BASE}/rules/test`, payload: { channelId: fbA.id, text: '完全無關的留言' } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.matched, false);
  });
});

describe('規則依渠道可見範圍顯示與編輯', () => {
  test('分店帳號只看到自己渠道的規則', async () => {
    await createRule(adminApp, { channelId: fbB.id, name: '渠道 B 的規則' });
    const res = await branchApp.inject({ method: 'GET', url: `${BASE}/rules` });
    assert.equal(res.statusCode, 200, res.body);
    const channels = new Set((res.json().data as Array<{ channelId: string }>).map((r) => r.channelId));
    assert.deepEqual([...channels], [fbA.id]);
  });

  test('讀看不到的渠道的規則：404 RULE_NOT_FOUND', async () => {
    const ruleB = (await createRule(adminApp, { channelId: fbB.id })).json().data;
    const res = await branchApp.inject({ method: 'GET', url: `${BASE}/rules/${ruleB.id}` });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal(res.json().error.code, 'RULE_NOT_FOUND');
  });

  test('唯讀層級修改規則：403 CHANNEL_ACCESS_DENIED；列表 canEdit=false', async () => {
    const ruleA = (await createRule()).json().data;
    const res = await readOnlyApp.inject({ method: 'PATCH', url: `${BASE}/rules/${ruleA.id}`, payload: { name: '偷改' } });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.code, 'CHANNEL_ACCESS_DENIED');
    const list = (await readOnlyApp.inject({ method: 'GET', url: `${BASE}/rules` })).json().data as Array<{ id: string; canEdit: boolean }>;
    assert.equal(list.find((r) => r.id === ruleA.id)?.canEdit, false);
  });

  test('其他租戶的規則：404', async () => {
    const res = await adminApp.inject({ method: 'GET', url: `${BASE}/rules/${otherRule.id}` });
    assert.equal(res.statusCode, 404, res.body);
  });

  test('刪除為軟刪除：204，資料列還在且不再出現在列表', async () => {
    const r = (await createRule()).json().data;
    const del = await adminApp.inject({ method: 'DELETE', url: `${BASE}/rules/${r.id}` });
    assert.equal(del.statusCode, 204, del.body);
    const row = await owner.commentReplyRule.findUniqueOrThrow({ where: { id: r.id } });
    assert.ok(row.deletedAt);
    const list = (await adminApp.inject({ method: 'GET', url: `${BASE}/rules` })).json().data as Array<{ id: string }>;
    assert.equal(list.some((x) => x.id === r.id), false);
  });
});

const noFeature = await fx.tenant({ plan: { features: ['inbox', 'channels', 'core'] } });
const noFeatureRole = await fx.role(noFeature.id, [VIEW, MANAGE, 'channel.view', 'channel.view_all']);
const noFeatureApp = await appOf(await fx.agent(noFeature.id, noFeatureRole.id), noFeature.id);

describe('方案 feature', () => {
  const app = noFeatureApp;

  test('方案不含時路由被擋：403，details 指出是方案未包含', async () => {
    const res = await app.inject({ method: 'GET', url: `${BASE}/rules` });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.details.requiredPermission, VIEW);
    assert.equal(res.json().error.details.reason, 'PLAN_FEATURE_NOT_INCLUDED');
  });

  test('平台勾選後可用：200', async () => {
    await updatePlan(owner, redis, noFeature.plan!.id, { features: ['inbox', 'channels', 'core', 'comment_reply'] });
    const res = await app.inject({ method: 'GET', url: `${BASE}/rules` });
    assert.equal(res.statusCode, 200, res.body);
  });
});
