/**
 * comment-reply 佇列的失敗分類（change add-comment-keyword-private-reply tasks 5.7，design D13；
 * spec comment-private-reply「網路錯誤自動重試」Scenario「資料庫錯誤重試用盡」、「私訊失敗的原因與可否重試」）。
 *
 * 真的 Redis＋BullMQ＋failed-alerts：
 * - 資料庫一直連不上：processor 丟錯，重試用盡後 job 進 failed set，發出 queue-failed 告警
 * - Meta 回 551（業務失敗）：紀錄記 FAILED，job 正常完成，沒有告警
 * 佇列名稱以 MARK 為前綴（與真的 comment-reply 佇列分開），processor 用 index.ts 同一個工廠。
 */
import {
  cleanupCommentReplyData,
  clearRateBuckets,
  createRule,
  disconnectAll,
  enableAllCapabilities,
  jobs,
  owner,
  postToPlatform,
  redis,
  resetHarness,
  resetPlatformSettings,
  tenantDb,
} from '#tests/support/comment-reply-harness.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { startFailedAlerts } from '#src/modules/queue-monitoring/failed-alerts.js';
import type { OpsAlert } from '#src/modules/ops-alert/ops-alert.service.js';
import { createCommentReplyJobRunner, createCommentReplyProcessor } from '#src/modules/comment-reply/comment-reply.worker.js';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { fbCommentPayload } from '#tests/support/meta-webhook.js';
import { urls } from '#tests/setup/feature-config.js';

const REDIS_URL = process.env.REDIS_URL!;
const connection = { url: REDIS_URL };
const fx = createCommentReplyFixtures(owner);
const graph = useFakeMetaGraph();
const alerts: OpsAlert[] = [];
const BROKEN = new PrismaClient({ datasources: { db: { url: urls.tenant.replace(/:[^:@/]+@/, ':wrong-password@') } } });

function setupQueue(name: string, prisma: PrismaClient) {
  const queue = new Queue(name, { connection });
  let events: QueueEvents | undefined;
  const worker = new Worker(name, createCommentReplyProcessor(createCommentReplyJobRunner({ prisma, redis })) as never, { connection, autorun: false });
  const alerting = startFailedAlerts({
    queueNames: [name],
    createQueueEvents: (n) => (events = new QueueEvents(n, { connection })),
    getJob: async (_n, id) => queue.getJob(id),
    sendAlert: async (a) => void alerts.push(a),
    dashboardUrl: 'https://crm.example/api/v1/platform/queues',
  });
  return {
    queue,
    worker,
    async start() {
      await events!.waitUntilReady();
      worker.run();
    },
    async close() {
      await worker.close();
      await alerting.close();
      await queue.obliterate({ force: true });
      await queue.close();
    },
  };
}

const dbDown = setupQueue(`cr-failed-db-${randomUUID()}`, BROKEN);
const business = setupQueue(`cr-failed-biz-${randomUUID()}`, tenantDb);

beforeAll(async () => {
  resetHarness();
  await enableAllCapabilities();
  await dbDown.start();
  await business.start();
});

afterAll(async () => {
  await dbDown.close();
  await business.close();
  await BROKEN.$disconnect();
  await resetPlatformSettings();
  await fx.cleanup(cleanupCommentReplyData);
  await disconnectAll();
});

test('資料庫錯誤重試用盡', async () => {
  const job = await dbDown.queue.add('deliver', { tenantId: randomUUID(), logId: randomUUID() }, { attempts: 2, backoff: { type: 'fixed', delay: 100 } });
  const mine = () => alerts.filter((a) => a.key.includes(dbDown.queue.name) && a.fields['job id'] === job.id);
  await vi.waitFor(() => assert.equal(mine().length, 1), { timeout: 20_000, interval: 100 });
  assert.equal(await dbDown.queue.getJobState(job.id!), 'failed');
  assert.match(mine()[0]!.key, /^queue-failed:/);
});

test('業務失敗（551）job 正常完成、沒有 queue-failed 告警', async () => {
  const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
  const fb = await fx.fbChannel(tenant.id);
  await createRule(tenant.id, fb.id, { keywords: ['+1'] });
  await clearRateBuckets([fb.id]);
  graph.on('POST', 'graph.facebook.com', '/v21.0/me/messages', { status: 400, body: { error: { message: 'cannot receive', code: 551 } } });
  const commentId = `biz-${Date.now()}`;
  await postToPlatform(fbCommentPayload([{ pageId: fb.externalAccountId, commentId, from: { id: 'U-biz', name: 'A' }, createdTime: Math.floor(Date.now() / 1000) }]));
  const log = await owner.commentReplyLog.findFirstOrThrow({ where: { channelId: fb.id, commentId } });
  assert.equal(jobs.length, 1);
  const job = await business.queue.add('deliver', jobs[0]!.row.payload, { attempts: 5, backoff: { type: 'fixed', delay: 100 } });
  await vi.waitFor(async () => assert.equal(await business.queue.getJobState(job.id!), 'completed'), { timeout: 10_000, interval: 100 });
  const after = await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id } });
  assert.equal(after.status, 'FAILED');
  assert.equal(after.reasonCode, 'USER_UNAVAILABLE');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(alerts.filter((a) => a.key.includes(business.queue.name)).length, 0);
});
