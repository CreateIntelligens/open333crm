/**
 * 每月私訊數上限（change add-comment-keyword-private-reply tasks 5.5；design D11、「上限檢查點」monthlyCommentReplies）。
 *
 * 留言經真的 webhook 收件，job 以 index.ts 同一個工廠處理；用量計數在 comment_reply_usages（台灣月份）。
 */
import {
  cleanupCommentReplyData,
  clearRateBuckets,
  createRule,
  disconnectAll,
  drainJobs,
  enableAllCapabilities,
  jobs,
  jobsForLog,
  owner,
  postToPlatform,
  recordingPublisher,
  redis,
  resetHarness,
  resetPlatformSettings,
  runJobOnce,
  tenantDb,
} from '#tests/support/comment-reply-harness.js';
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import { taipeiMonthString } from '@open333crm/core';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { fbCommentPayload } from '#tests/support/meta-webhook.js';
import { BASE, buildCommentReplyApp, MANAGE, VIEW } from '#tests/support/comment-reply-app.js';

const fx = createCommentReplyFixtures(owner);
const graph = useFakeMetaGraph();
let seq = 0;
const uid = (p: string) => `${p}${Date.now()}${++seq}`;
const FB_SEND = '/v21.0/me/messages';
const MONTH = () => taipeiMonthString(new Date());

beforeEach(async () => {
  resetHarness();
  await enableAllCapabilities();
});

afterAll(async () => {
  await resetPlatformSettings();
  await fx.cleanup(cleanupCommentReplyData);
  await disconnectAll();
});

async function setup(limit: number | null, rule: Parameters<typeof createRule>[2] = {}) {
  // channels、inbox：後台重試路由需要渠道檢視權限（方案天花板）
  const tenant = await fx.tenant({ plan: { features: ['comment_reply', 'channels', 'inbox', 'core'], limits: { monthlyCommentReplies: limit } } });
  const fb = await fx.fbChannel(tenant.id);
  await createRule(tenant.id, fb.id, { keywords: ['+1'], ...rule });
  await clearRateBuckets([fb.id]);
  return { tenant, fb };
}

async function comment(fb: { id: string; externalAccountId: string }) {
  const commentId = uid('c');
  await postToPlatform(fbCommentPayload([{ pageId: fb.externalAccountId, commentId, from: { id: uid('U'), name: '顧客' }, createdTime: Math.floor(Date.now() / 1000) }]));
  return owner.commentReplyLog.findFirstOrThrow({ where: { channelId: fb.id, commentId } });
}

/**
 * 後台「重試」走真的 POST /logs/:id/retry（comment-reply-log.routes → retryLogFlow → enqueueCommentReplyDelivery），
 * outbox 以 recordingPublisher 記下 job，之後由 index.ts 同一個 runner 工廠處理。
 */
async function retryViaRoute(tenantId: string, logId: string) {
  const role = await fx.role(tenantId, [VIEW, MANAGE, 'channel.view', 'channel.view_all', 'inbox.view']);
  const agent = await fx.agent(tenantId, role.id);
  const app = await buildCommentReplyApp({ owner, tenantDb, redis, events: recordingPublisher }, { id: agent.id, tenantId, roleId: role.id });
  try {
    const res = await app.inject({ method: 'POST', url: `${BASE}/logs/${logId}/retry` });
    assert.equal(res.statusCode, 202, res.body);
  } finally {
    await app.close();
  }
}

const okFb = () => graph.on('POST', 'graph.facebook.com', FB_SEND, () => ({ body: { recipient_id: uid('PSID'), message_id: uid('m_') } }));
const reload = (id: string) => owner.commentReplyLog.findUniqueOrThrow({ where: { id } });
const usage = (tenantId: string, month = MONTH()) => owner.commentReplyUsage.findUnique({ where: { tenantId_month: { tenantId, month } } });

describe('每月私訊數上限', () => {
  test('本月已達上限', async () => {
    const { fb, tenant } = await setup(1);
    okFb();
    const a = await comment(fb);
    const b = await comment(fb);
    await drainJobs();
    assert.equal((await reload(a.id)).status, 'SENT');
    const skipped = await reload(b.id);
    assert.equal(skipped.status, 'SKIPPED');
    assert.equal(skipped.reasonCode, 'PLAN_QUOTA_EXCEEDED');
    assert.equal(graph.calls('POST', FB_SEND).length, 1);
    assert.equal((await usage(tenant.id))!.sentCount, 1);
  });

  test('並行不超賣', async () => {
    const { fb, tenant } = await setup(3);
    okFb();
    const logs = [];
    for (let i = 0; i < 10; i++) logs.push(await comment(fb));
    await Promise.all(jobs.map((j) => runJobOnce(j)));
    const all = await Promise.all(logs.map((l) => reload(l.id)));
    assert.equal(all.filter((l) => l.status === 'SENT').length, 3);
    assert.equal(all.filter((l) => l.reasonCode === 'PLAN_QUOTA_EXCEEDED').length, 7);
    assert.equal(graph.calls('POST', FB_SEND).length, 3);
    assert.equal((await usage(tenant.id))!.sentCount, 3);
  });

  test('Meta 明確拒絕不吃額度', async () => {
    const { fb, tenant } = await setup(1);
    graph.on('POST', 'graph.facebook.com', FB_SEND, { status: 400, body: { error: { message: 'x', code: 551 } } }, { body: { recipient_id: 'P', message_id: 'm' } });
    const a = await comment(fb);
    await drainJobs();
    assert.equal((await reload(a.id)).status, 'FAILED');
    assert.equal((await reload(a.id)).quotaMonth, null);
    assert.equal((await usage(tenant.id))!.sentCount, 0);
    const b = await comment(fb);
    await drainJobs();
    assert.equal((await reload(b.id)).status, 'SENT');
    assert.equal((await usage(tenant.id))!.sentCount, 1);
  });

  test('跨月重新計算', async () => {
    const { fb, tenant } = await setup(1);
    await owner.commentReplyUsage.create({ data: { tenantId: tenant.id, month: '2000-01', sentCount: 1 } });
    okFb();
    const a = await comment(fb);
    await drainJobs();
    const after = await reload(a.id);
    assert.equal(after.status, 'SENT');
    assert.equal(after.quotaMonth, MONTH());
  });

  test('升級後重試被上限略過的紀錄', async () => {
    const { fb, tenant } = await setup(1);
    okFb();
    await comment(fb);
    const b = await comment(fb);
    await drainJobs();
    assert.equal((await reload(b.id)).reasonCode, 'PLAN_QUOTA_EXCEEDED');
    await owner.tenant.update({ where: { id: tenant.id }, data: { limitOverrides: { monthlyCommentReplies: 5 } } });
    await retryViaRoute(tenant.id, b.id);
    assert.equal(jobsForLog(b.id).length, 2, '重試排入第二個工作');
    await drainJobs();
    assert.equal((await reload(b.id)).status, 'SENT');
    assert.equal((await usage(tenant.id))!.sentCount, 2);
  });

  test('網路逾時後的額度不還', async () => {
    const { fb, tenant } = await setup(1);
    graph.on('POST', 'graph.facebook.com', FB_SEND, { throwError: 'ETIMEDOUT' });
    const a = await comment(fb);
    await drainJobs();
    assert.equal((await reload(a.id)).reasonCode, 'NETWORK');
    assert.equal((await usage(tenant.id))!.sentCount, 1);
    const b = await comment(fb);
    await drainJobs();
    assert.equal((await reload(b.id)).reasonCode, 'PLAN_QUOTA_EXCEEDED');
  });

  test('公開回覆不計入', async () => {
    const { fb, tenant } = await setup(1, { publicReplyEnabled: true, publicReplyTexts: ['已私訊'] });
    okFb();
    graph.on('POST', 'graph.facebook.com', /\/comments$/, { body: { id: 'R1' } });
    await comment(fb);
    await drainJobs();
    const u = (await usage(tenant.id))!;
    assert.equal(u.sentCount, 1);
    assert.equal(u.publicReplyCount, 1);
  });

  test('同一筆紀錄重試不重複扣減', async () => {
    const { fb, tenant } = await setup(5);
    graph.on('POST', 'graph.facebook.com', FB_SEND, { throwError: 'ECONNRESET' }, { throwError: 'ECONNRESET' }, { body: { recipient_id: 'P', message_id: 'm' } });
    const a = await comment(fb);
    await drainJobs();
    assert.equal((await reload(a.id)).status, 'SENT');
    assert.equal((await usage(tenant.id))!.sentCount, 1);
  });
});

describe('手動重試', () => {
  test('重試可重試的失敗', async () => {
    const { fb } = await setup(null);
    graph.on('POST', 'graph.facebook.com', FB_SEND, {
      status: 400,
      body: { error: { message: 'meta error 190', type: 'OAuthException', code: 190, error_subcode: 463, fbtrace_id: 'TRACE' } },
    });
    const log = await comment(fb);
    await drainJobs();
    assert.equal((await reload(log.id)).reasonCode, 'TOKEN_EXPIRED');

    // 權杖修好後重試：紀錄改回 PENDING、排入工作，工作執行完是 SENT
    okFb();
    await retryViaRoute(fb.tenantId, log.id);
    assert.equal((await reload(log.id)).status, 'PENDING');
    const retried = jobsForLog(log.id).at(-1)!;
    assert.equal(retried.row.name, 'deliver');
    assert.deepEqual(retried.row.payload, { tenantId: fb.tenantId, logId: log.id });
    await drainJobs();
    const after = await reload(log.id);
    assert.equal(after.status, 'SENT');
    assert.equal(after.reasonCode, null);
  });
});
