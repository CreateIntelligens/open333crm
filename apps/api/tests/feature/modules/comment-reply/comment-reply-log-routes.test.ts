/**
 * 觸發紀錄 API（change add-comment-keyword-private-reply tasks 7.3；spec comment-private-reply「觸發紀錄的查詢」
 * 「紀錄詳情的對話連結依權限顯示」「手動重試」、tenant-audit-log「重試觸發紀錄時寫稽核」）。
 *
 * 走真實的 comment-reply-log.routes、requirePermission、渠道可見範圍與 app_tenant 連線。
 * outbox 以真實的 writeOutbox 寫入、快路徑不送 Redis（斷言 outbox 列即可，送進佇列由 outbox 測試負責）。
 * 「工作執行成功後紀錄是 SENT」需要送出消費者（第 5 節），這裡只斷言重新排入的 job 與紀錄狀態。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, test } from 'vitest';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { writeOutbox } from '@open333crm/core';
import { loadEnvConfig } from '#src/config/env.js';
import { COMMENT_REPLY_JOB_DELIVER, COMMENT_REPLY_QUEUE } from '#src/modules/comment-reply/comment-reply.types.js';
import { urls } from '#tests/setup/feature-config.js';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { createCommentReplyRecords } from '#tests/support/comment-reply-records.js';
import { BASE, buildCommentReplyApp, MANAGE, VIEW } from '#tests/support/comment-reply-app.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: urls.tenant } } });
const redis = new Redis(process.env.REDIS_URL!);
const fx = createCommentReplyFixtures(owner);
const rec = createCommentReplyRecords(owner);
const apps: Array<{ close: () => Promise<unknown> }> = [];
const events = { write: writeOutbox, dispatch: async () => {} };

const tenant = await fx.tenant({ plan: { features: ['comment_reply', 'channels', 'inbox', 'core'] } });
const T = tenant.id;
const fbA = await fx.fbChannel(T);
const fbB = await fx.fbChannel(T);

const adminRole = await fx.role(T, [VIEW, MANAGE, 'channel.view', 'channel.view_all', 'inbox.view']);
const noInboxRole = await fx.role(T, [VIEW, MANAGE, 'channel.view', 'channel.view_all']);
const branchRole = await fx.role(T, [VIEW, MANAGE, 'channel.view', 'inbox.view']);
const noViewRole = await fx.role(T, ['channel.view', 'channel.view_all', 'inbox.view']);
const appOf = async (roleId: string, channels?: Array<{ channelId: string; accessLevel?: 'full' | 'read_only' }>) => {
  const agent = await fx.agent(T, roleId, { channels });
  const app = await buildCommentReplyApp({ owner, tenantDb, redis, events }, { id: agent.id, tenantId: T, roleId });
  apps.push(app);
  return { app, agent };
};
const { app: adminApp, agent: admin } = await appOf(adminRole.id);
const { app: noInboxApp } = await appOf(noInboxRole.id);
const { app: branchApp } = await appOf(branchRole.id, [{ channelId: fbA.id }]);
const { app: readOnlyApp } = await appOf(branchRole.id, [{ channelId: fbA.id, accessLevel: 'read_only' }]);
const { app: noViewApp } = await appOf(noViewRole.id);
const viewOnlyRole = await fx.role(T, [VIEW, 'channel.view', 'channel.view_all', 'inbox.view']);
const { app: viewOnlyApp } = await appOf(viewOnlyRole.id);

const ruleA = await rec.rule(T, fbA.id, { name: '渠道 A 規則', postIds: [`${fbA.externalAccountId}_9`], postSnapshots: [{ postId: `${fbA.externalAccountId}_9`, excerpt: '雙十一活動', permalink: 'https://facebook.com/p/9' }] });
const ruleB = await rec.rule(T, fbB.id, { name: '渠道 B 規則' });
const authorA = await rec.author(T, fbA.id);
const authorB = await rec.author(T, fbB.id);
const days = (n: number) => new Date(Date.now() - n * 24 * 3600_000);

const logA = (data: Parameters<typeof rec.log>[4] = {}) => rec.log(T, fbA.id, ruleA.id, authorA.id, data);
const sentA = await logA({ status: 'SENT', sentAt: days(0), postId: `${fbA.externalAccountId}_9`, commenterName: '陳大文', commentText: '+1 想要' });
const failedA = await logA({ status: 'FAILED', reasonCode: 'TOKEN_EXPIRED' });
const logB = await rec.log(T, fbB.id, ruleB.id, authorB.id, { status: 'FAILED', reasonCode: 'NETWORK' });

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await fx.cleanup(rec.cleanup);
  await redis.quit();
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

const ids = (body: { data: { items: Array<{ id: string }> } }) => body.data.items.map((i) => i.id);

describe('觸發紀錄的查詢', () => {
  test('分店帳號只看到自己渠道的紀錄（列表與摘要）', async () => {
    const list = await branchApp.inject({ method: 'GET', url: `${BASE}/logs` });
    assert.equal(list.statusCode, 200, list.body);
    const items = list.json().data.items as Array<{ channel: { id: string } }>;
    assert.ok(items.length >= 2);
    assert.ok(items.every((i) => i.channel.id === fbA.id));

    const summary = await branchApp.inject({ method: 'GET', url: `${BASE}/logs/summary` });
    assert.equal(summary.statusCode, 200, summary.body);
    const all = await adminApp.inject({ method: 'GET', url: `${BASE}/logs/summary` });
    assert.equal(summary.json().data.counts.FAILED, all.json().data.counts.FAILED - 1, '分店的失敗數不含渠道 B');
    assert.equal(typeof summary.json().data.failed24h, 'number');
  });

  test('讀看不到的渠道的紀錄：404 LOG_NOT_FOUND', async () => {
    const res = await branchApp.inject({ method: 'GET', url: `${BASE}/logs/${logB.id}` });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal(res.json().error.code, 'LOG_NOT_FOUND');
  });

  test('沒有檢視權限：403，details.requiredPermission 是 comment_reply.view', async () => {
    const res = await noViewApp.inject({ method: 'GET', url: `${BASE}/logs` });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.details.requiredPermission, VIEW);
  });

  test('列表欄位：貼文摘要來自規則快照、規則名稱、receivedAt、retryable', async () => {
    const res = await adminApp.inject({ method: 'GET', url: `${BASE}/logs?channelId=${fbA.id}` });
    const items = res.json().data.items as Array<Record<string, any>>;
    const sent = items.find((i) => i.id === sentA.id)!;
    assert.equal(sent.post.excerpt, '雙十一活動');
    assert.equal(sent.rule.name, '渠道 A 規則');
    assert.equal(sent.rule.deleted, false);
    assert.ok(!Number.isNaN(Date.parse(sent.receivedAt)));
    assert.equal(sent.retryable, false);
    assert.equal(sent.conversationId, undefined, '列表不回傳 conversationId');
    assert.equal(items.find((i) => i.id === failedA.id)!.retryable, true);
  });

  test('狀態可多選（status=A&status=B）；q 搜尋留言者名稱與內容（% 當一般字元）', async () => {
    const multi = await adminApp.inject({ method: 'GET', url: `${BASE}/logs?status=SENT&status=FAILED&channelId=${fbA.id}` });
    assert.equal(multi.statusCode, 200, multi.body);
    assert.deepEqual(new Set(ids(multi.json())), new Set([sentA.id, failedA.id]));

    const byName = await adminApp.inject({ method: 'GET', url: `${BASE}/logs?q=${encodeURIComponent('陳大')}` });
    assert.deepEqual(ids(byName.json()), [sentA.id]);
    const byText = await adminApp.inject({ method: 'GET', url: `${BASE}/logs?q=${encodeURIComponent('想要')}` });
    assert.deepEqual(ids(byText.json()), [sentA.id]);
    const wildcard = await adminApp.inject({ method: 'GET', url: `${BASE}/logs?q=${encodeURIComponent('%')}` });
    assert.deepEqual(ids(wildcard.json()), []);
  });

  test('cursor 分頁穩定：同一毫秒建立的紀錄也不重複、不遺漏', async () => {
    const at = new Date();
    const same = [];
    for (let i = 0; i < 5; i++) same.push(await rec.log(T, fbB.id, ruleB.id, authorB.id, { status: 'SENT', createdAt: at, commentText: '分頁' }));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const qs: string = `q=${encodeURIComponent('分頁')}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await adminApp.inject({ method: 'GET', url: `${BASE}/logs?${qs}` });
      assert.equal(res.statusCode, 200, res.body);
      seen.push(...ids(res.json()));
      cursor = res.json().data.nextCursor;
      if (!cursor) break;
    }
    assert.equal(seen.length, 5);
    assert.deepEqual(new Set(seen), new Set(same.map((l) => l.id)));
  });

  test('countOnly＋since：回新紀錄數', async () => {
    await new Promise((r) => setTimeout(r, 20));
    const since = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    await logA({ status: 'PENDING', commentText: '新的一筆' });
    const res = await adminApp.inject({ method: 'GET', url: `${BASE}/logs?channelId=${fbA.id}&since=${encodeURIComponent(since)}&countOnly=true` });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.count, 1);
  });

  test('已私訊過的詳情指出先前的紀錄', async () => {
    const dup = await logA({ status: 'SKIPPED_DUPLICATE', holderLogId: sentA.id });
    const res = await adminApp.inject({ method: 'GET', url: `${BASE}/logs/${dup.id}` });
    assert.equal(res.json().data.holderLogId, sentA.id);
  });
});

describe('紀錄詳情的對話連結依權限顯示', () => {
  test('沒有收件匣權限：沒有 conversationId，customerReplied 為 true', async () => {
    const conversation = await owner.conversation.create({
      data: { tenantId: T, contactId: authorA.contactId, channelId: fbA.id, channelType: 'FB' },
    });
    const replied = await logA({ status: 'SENT', sentAt: days(0), conversationId: conversation.id, customerRepliedAt: new Date() });
    const without = await noInboxApp.inject({ method: 'GET', url: `${BASE}/logs/${replied.id}` });
    assert.equal(without.statusCode, 200, without.body);
    assert.equal('conversationId' in without.json().data, false);
    assert.equal(without.json().data.customerReplied, true);

    const withInbox = await adminApp.inject({ method: 'GET', url: `${BASE}/logs/${replied.id}` });
    assert.equal(withInbox.json().data.conversationId, conversation.id);
  });
});

describe('手動重試', () => {
  const retry = (app: typeof adminApp, id: string) => app.inject({ method: 'POST', url: `${BASE}/logs/${id}/retry` });

  test('重試可重試的失敗：202 { status: PENDING }，紀錄改回 PENDING 並排入送出工作', async () => {
    const log = await logA({ status: 'FAILED', reasonCode: 'TOKEN_EXPIRED', commentCreatedAt: days(2), metaErrorCode: 190 });
    const res = await retry(adminApp, log.id);
    assert.equal(res.statusCode, 202, res.body);
    assert.deepEqual(res.json().data, { status: 'PENDING' });
    const row = await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } });
    assert.equal(row.status, 'PENDING');
    assert.equal(row.reasonCode, null);
    assert.equal(row.metaErrorCode, null);
    const jobs = await owner.outbox.findMany({ where: { tenantId: T, kind: 'job', queueName: COMMENT_REPLY_QUEUE } });
    const job = jobs.find((j) => (j.payload as { logId?: string }).logId === log.id);
    assert.ok(job, '要排入 comment-reply 佇列');
    assert.equal(job.name, COMMENT_REPLY_JOB_DELIVER);
    assert.deepEqual(job.payload, { tenantId: T, logId: log.id }, 'job 資料只有識別欄位');
  });

  test('升級後重試被上限略過的紀錄：SKIPPED／PLAN_QUOTA_EXCEEDED 可重試', async () => {
    const log = await logA({ status: 'SKIPPED', reasonCode: 'PLAN_QUOTA_EXCEEDED', commentCreatedAt: days(1) });
    const res = await retry(adminApp, log.id);
    assert.equal(res.statusCode, 202, res.body);
  });

  test('重試不可重試的失敗：409 RETRY_NOT_ALLOWED，details.reason 是 NOT_RETRYABLE', async () => {
    const log = await logA({ status: 'FAILED', reasonCode: 'USER_UNAVAILABLE' });
    const res = await retry(adminApp, log.id);
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'RETRY_NOT_ALLOWED');
    assert.equal(res.json().error.details.reason, 'NOT_RETRYABLE');
  });

  test('重試已送出的紀錄：409，details.reason 是 NOT_FAILED', async () => {
    const res = await retry(adminApp, sentA.id);
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.details.reason, 'NOT_FAILED');
  });

  test('重試已過期的留言：409，details.reason 是 EXPIRED', async () => {
    const log = await logA({ status: 'FAILED', reasonCode: 'NETWORK', commentCreatedAt: days(7) });
    const res = await retry(adminApp, log.id);
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.details.reason, 'EXPIRED');
    assert.equal((await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } })).status, 'FAILED');
  });

  test('只有檢視權限重試：403，details.requiredPermission 是 comment_reply.manage，紀錄不變、不排入工作', async () => {
    const log = await logA({ status: 'FAILED', reasonCode: 'NETWORK', commentCreatedAt: days(1) });
    const res = await retry(viewOnlyApp, log.id);
    assert.equal(res.statusCode, 403, res.body);
    // 斷言是 manage 這道守門（不是渠道可見範圍或其他檢查剛好給 403，突變 12.18）
    assert.equal(res.json().error.details.requiredPermission, MANAGE);
    assert.equal((await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } })).status, 'FAILED');
    const jobs = await owner.outbox.findMany({ where: { tenantId: T, kind: 'job', queueName: COMMENT_REPLY_QUEUE } });
    assert.equal(jobs.filter((j) => (j.payload as { logId?: string }).logId === log.id).length, 0);
  });

  test('唯讀層級重試：403 CHANNEL_ACCESS_DENIED；看不到的渠道：404', async () => {
    const log = await logA({ status: 'FAILED', reasonCode: 'NETWORK' });
    const ro = await retry(readOnlyApp, log.id);
    assert.equal(ro.statusCode, 403, ro.body);
    assert.equal(ro.json().error.code, 'CHANNEL_ACCESS_DENIED');
    const hidden = await retry(branchApp, logB.id);
    assert.equal(hidden.statusCode, 404, hidden.body);
  });

  test('重試觸發紀錄時寫稽核：action comment_reply.log.retry，payload 不含留言內容與留言者名稱', async () => {
    const log = await logA({ status: 'FAILED', reasonCode: 'UNKNOWN', commenterName: '個資名稱', commentText: '個資留言' });
    const res = await retry(adminApp, log.id);
    assert.equal(res.statusCode, 202, res.body);
    const audit = await owner.tenantAuditLog.findFirst({ where: { tenantId: T, action: 'comment_reply.log.retry', targetId: log.id } });
    assert.ok(audit);
    assert.equal(audit.targetType, 'comment_reply_log');
    assert.equal(audit.actorId, admin.id);
    const payload = JSON.stringify(audit.payload);
    assert.ok(!payload.includes('個資名稱') && !payload.includes('個資留言'));
  });
});
