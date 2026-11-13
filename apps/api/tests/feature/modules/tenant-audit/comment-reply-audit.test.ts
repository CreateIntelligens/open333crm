/**
 * 留言自動私訊的租戶稽核（change add-comment-keyword-private-reply tasks 7.6，design D24；
 * spec tenant-audit-log「記錄租戶內的敏感操作」）。
 *
 * 規則建立、修改、刪除、啟用切換、排序與開關留言接收各寫一筆，與資料同一交易；payload 不含留言內容與留言者名稱。
 * 走真實的路由、recordTenantAudit 與 app_tenant 連線；Graph API 以 fake-meta-graph 取代。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { urls } from '#tests/setup/feature-config.js';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { createCommentReplyRecords } from '#tests/support/comment-reply-records.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { BASE, buildCommentReplyApp, MANAGE, restorePlatformSettings, setPlatformCapabilities, VIEW } from '#tests/support/comment-reply-app.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: urls.tenant } } });
const redis = new Redis(process.env.REDIS_URL!);
const fx = createCommentReplyFixtures(owner);
const rec = createCommentReplyRecords(owner);
const graph = useFakeMetaGraph();

const tenant = await fx.tenant({ plan: { features: ['comment_reply', 'channels', 'inbox', 'core'] } });
const T = tenant.id;
const fb = await fx.fbChannel(T, { mode: 'own_app', externalAccountId: `${Date.now()}7` });
const role = await fx.role(T, [VIEW, MANAGE, 'channel.view', 'channel.view_all', 'channel.update']);
const agent = await fx.agent(T, role.id);
const app = await buildCommentReplyApp({ owner, tenantDb, redis }, { id: agent.id, tenantId: T, roleId: role.id });

beforeAll(async () => {
  await setPlatformCapabilities(owner, {});
});

afterAll(async () => {
  await app.close();
  await restorePlatformSettings(owner);
  await fx.cleanup(rec.cleanup);
  await redis.quit();
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

const auditsOf = (action: string) => owner.tenantAuditLog.findMany({ where: { tenantId: T, action }, orderBy: { createdAt: 'asc' } });

test('建立留言規則時寫稽核：action comment_reply.rule.create、targetType comment_reply_rule、payload.name 是規則名稱', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `${BASE}/rules`,
    payload: { channelId: fb.id, name: '週年慶 +1', keywords: ['+1'], content: { type: 'text', text: '感謝留言' } },
  });
  assert.equal(res.statusCode, 201, res.body);
  const [audit] = await auditsOf('comment_reply.rule.create');
  assert.ok(audit, '要有一筆稽核');
  assert.equal(audit.targetType, 'comment_reply_rule');
  assert.equal(audit.targetId, res.json().data.id);
  assert.equal(audit.actorId, agent.id);
  assert.equal((audit.payload as Record<string, unknown>).name, '週年慶 +1');
});

test('修改、啟用切換、排序、刪除各寫一筆', async () => {
  const a = (await app.inject({ method: 'POST', url: `${BASE}/rules`, payload: { channelId: fb.id, name: 'A', keywords: ['a'], content: { type: 'text', text: 'x' } } })).json().data;
  const b = (await app.inject({ method: 'POST', url: `${BASE}/rules`, payload: { channelId: fb.id, name: 'B', keywords: ['b'], content: { type: 'text', text: 'x' } } })).json().data;

  assert.equal((await app.inject({ method: 'PATCH', url: `${BASE}/rules/${a.id}`, payload: { name: 'A2' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: `${BASE}/rules/${a.id}/active`, payload: { isActive: false } })).statusCode, 200);
  const list = (await app.inject({ method: 'GET', url: `${BASE}/rules` })).json().data as Array<{ id: string }>;
  const ids = list.map((r) => r.id).reverse();
  assert.equal((await app.inject({ method: 'PUT', url: `${BASE}/rules/order`, payload: { ids } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `${BASE}/rules/${b.id}` })).statusCode, 204);

  const update = await auditsOf('comment_reply.rule.update');
  assert.equal(update.length, 1);
  assert.equal(update[0].targetId, a.id);
  assert.deepEqual((update[0].payload as Record<string, unknown>).fields, ['name']);
  const toggle = await auditsOf('comment_reply.rule.toggle');
  assert.equal(toggle.length, 1);
  assert.equal((toggle[0].payload as Record<string, unknown>).isActive, false);
  const reorder = await auditsOf('comment_reply.rule.reorder');
  assert.equal(reorder.length, 1);
  assert.deepEqual((reorder[0].payload as Record<string, unknown>).ids, ids);
  const del = await auditsOf('comment_reply.rule.delete');
  assert.equal(del.length, 1);
  assert.equal(del[0].targetId, b.id);
});

test('開關留言接收各寫一筆 channel.comment_subscription.update', async () => {
  graph.on('POST', 'graph.facebook.com', `/v21.0/${fb.externalAccountId}/subscribed_apps`, { body: { success: true } });
  assert.equal((await app.inject({ method: 'POST', url: `${BASE}/channels/${fb.id}/subscribe-comments` })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `${BASE}/channels/${fb.id}/subscribe-comments` })).statusCode, 200);
  const audits = await auditsOf('channel.comment_subscription.update');
  assert.equal(audits.length, 2);
  assert.deepEqual(audits.map((a) => (a.payload as Record<string, unknown>).receiving), [true, false]);
  assert.ok(audits.every((a) => a.targetType === 'channel' && a.targetId === fb.id));
});

test('失敗的請求不寫稽核（與資料同一交易）', async () => {
  const before = (await auditsOf('comment_reply.rule.create')).length;
  const res = await app.inject({
    method: 'POST',
    url: `${BASE}/rules`,
    payload: { channelId: fb.id, name: '券', keywords: ['+1'], content: { type: 'text', text: '{{coupon.url}}' } },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal((await auditsOf('comment_reply.rule.create')).length, before);
});

test('payload 不含留言內容與留言者名稱', async () => {
  const rule = await rec.rule(T, fb.id);
  const author = await rec.author(T, fb.id);
  const log = await rec.log(T, fb.id, rule.id, author.id, { status: 'FAILED', reasonCode: 'NETWORK', commenterName: '林個資', commentText: '我的電話 0912' });
  const res = await app.inject({ method: 'POST', url: `${BASE}/logs/${log.id}/retry` });
  assert.equal(res.statusCode, 202, res.body);
  const all = await owner.tenantAuditLog.findMany({ where: { tenantId: T, action: { startsWith: 'comment_reply.' } } });
  for (const a of all) {
    const payload = JSON.stringify(a.payload);
    assert.ok(!payload.includes('林個資') && !payload.includes('0912'), `${a.action} 的 payload 含個資：${payload}`);
  }
});
