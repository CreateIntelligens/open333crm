/**
 * 佇列監控列出留言自動私訊佇列（change add-comment-keyword-private-reply tasks 9.5；
 * spec queue-monitoring「列出所有佇列」的「列出留言自動私訊佇列」）。
 *
 * 用測試 Redis 建真實的 BullMQ 佇列（createMonitoredQueues），在 comment-reply 放一個失敗的 job，
 * 經監控路由（真實的 auth、監控 cookie、網段限制）讀佇列清單與 job 細節。結束時清空這個佇列。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { Queue, Worker, UnrecoverableError } from 'bullmq';
import { buildQueueMonitoringApp, OFFICE_IP, QUEUES_PATH, type QueueMonitoringApp } from '#tests/support/queue-monitoring-app.js';
import { createMonitoredQueues } from '#src/modules/queue-monitoring/monitored-queues.js';
import { COMMENT_REPLY_JOB_DELIVER, COMMENT_REPLY_QUEUE } from '#src/modules/comment-reply/comment-reply.types.js';

const redisUrl = process.env.REDIS_URL!;
let queues: Queue[];
let ctx: QueueMonitoringApp;
let cookie: string;
let failedJobId: string;

beforeAll(async () => {
  queues = createMonitoredQueues(redisUrl);
  const commentReply = queues.find((q) => q.name === COMMENT_REPLY_QUEUE);
  assert.ok(commentReply, '監控清單要有 comment-reply');
  await commentReply.obliterate({ force: true });

  // 讓一個 job 失敗：Worker 丟不可重試的錯誤
  const worker = new Worker(
    COMMENT_REPLY_QUEUE,
    async () => {
      throw new UnrecoverableError('資料庫連線中斷');
    },
    { connection: { url: redisUrl } },
  );
  const failed = new Promise<void>((resolve) => worker.on('failed', () => resolve()));
  const job = await commentReply.add(COMMENT_REPLY_JOB_DELIVER, { tenantId: 't1', logId: 'l1' }, { attempts: 1 });
  failedJobId = String(job.id);
  await failed;
  await worker.close();

  ctx = await buildQueueMonitoringApp({ allowedCidrs: '60.248.142.0/24', queues });
  cookie = await ctx.sessionCookie(OFFICE_IP);
});

afterAll(async () => {
  await ctx?.app.close();
  await queues.find((q) => q.name === COMMENT_REPLY_QUEUE)?.obliterate({ force: true });
  await Promise.all(queues.map((q) => q.close()));
});

test('列出留言自動私訊佇列：清單包含 API 行程的 comment-reply，失敗的 job 顯示失敗原因', async () => {
  const list = await ctx.inject({ method: 'GET', url: `${QUEUES_PATH}/api/queues`, ip: OFFICE_IP, cookie });
  assert.equal(list.statusCode, 200, list.body);
  const names = (list.json() as { queues: Array<{ name: string }> }).queues.map((q) => q.name);
  assert.ok(names.includes(COMMENT_REPLY_QUEUE), names.join(','));

  const job = await ctx.inject({ method: 'GET', url: `${QUEUES_PATH}/api/queues/${COMMENT_REPLY_QUEUE}/${failedJobId}`, ip: OFFICE_IP, cookie });
  assert.equal(job.statusCode, 200, job.body);
  assert.equal((job.json() as { job: { failedReason: string } }).job.failedReason, '資料庫連線中斷');
});
