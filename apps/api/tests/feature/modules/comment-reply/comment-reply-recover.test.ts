/**
 * 遺失或卡住的工作自動補回（change add-comment-keyword-private-reply tasks 10.1，design D2；
 * spec comment-private-reply「遺失或卡住的工作自動補回」），以及健康統計不把限流排隊算成卡住（D25）。
 *
 * 留言經真的 webhook 收件；補回排程（comment-reply-recover 的 run 函式）以 prismaAdmin 掃描、app_tenant 寫入，
 * 補回的 job 以 index.ts 同一個工廠處理。
 */
import {
  adminDb,
  cleanupCommentReplyData,
  clearRateBuckets,
  createRule,
  disconnectAll,
  drainJobs,
  enableAllCapabilities,
  jobs,
  owner,
  postToPlatform,
  recordingPublisher,
  redis,
  resetHarness,
  resetPlatformSettings,
  tenantDb,
} from '#tests/support/comment-reply-harness.js';
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { fbCommentPayload } from '#tests/support/meta-webhook.js';
import { runCommentReplyRecover } from '#src/modules/comment-reply/comment-reply-maintenance.flow.js';
import { collectHealthSnapshot } from '#src/modules/comment-reply/comment-reply-health.js';

const fx = createCommentReplyFixtures(owner);
const graph = useFakeMetaGraph();
let seq = 0;
const uid = (p: string) => `${p}${Date.now()}${++seq}`;
const FB_SEND = '/v21.0/me/messages';

beforeEach(async () => {
  resetHarness();
  await enableAllCapabilities();
});

afterAll(async () => {
  await resetPlatformSettings();
  await fx.cleanup(cleanupCommentReplyData);
  await disconnectAll();
});

async function setupAndComment(createdTime = Math.floor(Date.now() / 1000)) {
  const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
  const fb = await fx.fbChannel(tenant.id);
  await createRule(tenant.id, fb.id, { keywords: ['+1'] });
  await clearRateBuckets([fb.id]);
  const commentId = uid('c');
  await postToPlatform(fbCommentPayload([{ pageId: fb.externalAccountId, commentId, from: { id: uid('U'), name: 'A' }, createdTime }]));
  const log = await owner.commentReplyLog.findFirstOrThrow({ where: { channelId: fb.id, commentId } });
  return { tenant, fb, log };
}

const recover = () => runCommentReplyRecover({ admin: adminDb, prisma: tenantDb, events: recordingPublisher });
const ago = (ms: number) => new Date(Date.now() - ms);

describe('遺失或卡住的工作自動補回', () => {
  test('Redis 裡的工作不見了', async () => {
    const { log } = await setupAndComment();
    jobs.length = 0; // job 從 Redis 消失
    await owner.$executeRaw`UPDATE comment_reply_logs SET "updatedAt" = ${ago(11 * 60_000)} WHERE id = ${log.id}::uuid`;
    graph.on('POST', 'graph.facebook.com', FB_SEND, { body: { recipient_id: 'PSID-r', message_id: 'm-r' } });
    await recover();
    assert.equal(jobs.length, 1);
    await drainJobs();
    assert.equal((await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } })).status, 'SENT');
    assert.equal(graph.calls('POST', FB_SEND).length, 1);
  });

  test('PENDING 未滿 10 分鐘不補', async () => {
    await setupAndComment();
    jobs.length = 0;
    await recover();
    assert.equal(jobs.length, 0);
  });

  test('卡住超過 7 天', async () => {
    const { log } = await setupAndComment(Math.floor(Date.now() / 1000) - 8 * 86400);
    jobs.length = 0;
    await recover();
    const after = await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } });
    assert.equal(after.status, 'EXPIRED');
    assert.equal(after.reasonCode, 'WINDOW_EXPIRED');
    assert.equal(jobs.length, 0);
    assert.equal(graph.calls('POST', FB_SEND).length, 0);
  });

  test('SENDING 超過 2 分鐘重新排入', async () => {
    const { log } = await setupAndComment();
    jobs.length = 0;
    await owner.commentReplyLog.update({ where: { id: log.id }, data: { status: 'SENDING', sendAttemptedAt: ago(3 * 60_000), quotaMonth: '2026-11' } });
    graph.on('POST', 'graph.facebook.com', FB_SEND, { status: 400, body: { error: { message: 'already replied', code: 10900 } } });
    await recover();
    assert.equal(jobs.length, 1);
    await drainJobs();
    const after = await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } });
    assert.equal(after.status, 'SENT');
    assert.equal(after.reasonCode, 'SENT_UNCONFIRMED');
  });
});

describe('健康統計', () => {
  test('限流排隊的紀錄不算卡住', async () => {
    const { log } = await setupAndComment();
    const before = (await collectHealthSnapshot({ admin: adminDb, redis })).stuckPending;
    await owner.$executeRaw`UPDATE comment_reply_logs SET "reasonCode" = 'RATE_LIMIT_QUEUED', "updatedAt" = ${ago(40 * 60_000)} WHERE id = ${log.id}::uuid`;
    assert.equal((await collectHealthSnapshot({ admin: adminDb, redis })).stuckPending, before);
    await owner.$executeRaw`UPDATE comment_reply_logs SET "reasonCode" = NULL, "updatedAt" = ${ago(40 * 60_000)} WHERE id = ${log.id}::uuid`;
    assert.equal((await collectHealthSnapshot({ admin: adminDb, redis })).stuckPending, before + 1);
    await owner.commentReplyLog.update({ where: { id: log.id }, data: { status: 'EXPIRED' } });
  });
});
