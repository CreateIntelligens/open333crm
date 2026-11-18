/**
 * comment-reply 佇列的真實接線（change add-comment-keyword-private-reply tasks 5.6，design D1）。
 *
 * 其他 feature 測試把 outbox 的快路徑換成記錄 job；這裡不換：webhook 收件寫 outbox，commit 後的快路徑（或 outbox relay）
 * 把 job 送進真的 BullMQ（Redis），由 index.ts 同一個組法的 Worker（bullWorkerFactory＋createCommentReplyProcessor）處理到 SENT。
 * 確認佇列名稱、job 名稱、job id（outbox id）與 job data 三邊接得起來。
 */
import {
  adminDb,
  cleanupCommentReplyData,
  clearRateBuckets,
  createRule,
  disconnectAll,
  enableAllCapabilities,
  owner,
  PLATFORM_APP_SECRET,
  redis,
  resetHarness,
  resetPlatformSettings,
  silentIo,
  tenantDb,
} from '#tests/support/comment-reply-harness.js';
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test, vi } from 'vitest';
import { Queue } from 'bullmq';
import { closeOutboxQueues, writeOutbox } from '@open333crm/core';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { fbCommentPayload, signed } from '#tests/support/meta-webhook.js';
import { processPlatformMetaWebhook } from '#src/modules/webhook/webhook.service.js';
import { bullWorkerFactory, startQueueWorkers } from '#src/events/subscriber-workers.js';
import { createCommentReplyJobRunner, createCommentReplyProcessor } from '#src/modules/comment-reply/comment-reply.worker.js';
import { COMMENT_REPLY_QUEUE } from '#src/modules/comment-reply/comment-reply.types.js';
import { runOutboxRelay } from '#src/modules/outbox/outbox.scheduler.js';
import type { EventPublisher } from '#src/events/outbox-publisher.js';

const fx = createCommentReplyFixtures(owner);
const graph = useFakeMetaGraph();
const queue = new Queue(COMMENT_REPLY_QUEUE, { connection: { url: process.env.REDIS_URL! } });
const workers = startQueueWorkers(
  { [COMMENT_REPLY_QUEUE]: createCommentReplyProcessor(createCommentReplyJobRunner({ prisma: tenantDb, redis })) as never },
  bullWorkerFactory(process.env.REDIS_URL!),
);

beforeEach(async () => {
  resetHarness();
  await enableAllCapabilities();
});

afterAll(async () => {
  await workers.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await closeOutboxQueues();
  await resetPlatformSettings();
  await fx.cleanup(cleanupCommentReplyData);
  await disconnectAll();
});

async function setup() {
  const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
  const fb = await fx.fbChannel(tenant.id);
  await createRule(tenant.id, fb.id, { keywords: ['+1'] });
  await clearRateBuckets([fb.id]);
  return { tenant, fb };
}

function post(fb: { externalAccountId: string }, commentId: string, events?: EventPublisher) {
  const { raw, headers } = signed(
    fbCommentPayload([{ pageId: fb.externalAccountId, commentId, from: { id: `U-${commentId}`, name: 'A' }, createdTime: Math.floor(Date.now() / 1000) }]),
    PLATFORM_APP_SECRET,
  );
  return processPlatformMetaWebhook(adminDb, silentIo, raw, headers, { tenantPrisma: tenantDb, redis, ...(events ? { events } : {}) });
}

test('快路徑：一則留言經 outbox → BullMQ → Worker 到 SENT', async () => {
  const { fb, tenant } = await setup();
  graph.on('POST', 'graph.facebook.com', '/v21.0/me/messages', { body: { recipient_id: 'PSID-w', message_id: 'm-w' } });
  const commentId = `wire-${Date.now()}`;
  await post(fb, commentId);
  const log = await owner.commentReplyLog.findFirstOrThrow({ where: { channelId: fb.id, commentId } });
  const outbox = await owner.outbox.findFirstOrThrow({ where: { tenantId: tenant.id, queueName: COMMENT_REPLY_QUEUE } });

  await vi.waitFor(async () => assert.equal((await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } })).status, 'SENT'), { timeout: 10_000, interval: 100 });
  const job = await queue.getJob(outbox.id);
  assert.ok(job, 'job id 是 outbox id');
  assert.equal(job.name, 'deliver');
  assert.deepEqual(job.data, { tenantId: tenant.id, logId: log.id });
  assert.equal(job.opts.attempts, 5);
  assert.equal(graph.calls('POST', '/v21.0/me/messages').length, 1);
});

test('快路徑沒送出：outbox relay 補送後到 SENT', async () => {
  const { fb } = await setup();
  graph.on('POST', 'graph.facebook.com', '/v21.0/me/messages', { body: { recipient_id: 'PSID-r', message_id: 'm-r' } });
  const lost: EventPublisher = {
    write: (tx, input) => writeOutbox(tx as never, input),
    dispatch: async () => {},
  };
  const commentId = `relay-${Date.now()}`;
  await post(fb, commentId, lost);
  const log = await owner.commentReplyLog.findFirstOrThrow({ where: { channelId: fb.id, commentId } });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } })).status, 'PENDING');

  await runOutboxRelay(adminDb, new Date(Date.now() + 3 * 60_000));
  await vi.waitFor(async () => assert.equal((await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } })).status, 'SENT'), { timeout: 10_000, interval: 100 });
});
