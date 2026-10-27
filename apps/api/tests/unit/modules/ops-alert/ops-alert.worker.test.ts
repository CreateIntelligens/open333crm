/**
 * ops-alert 佇列的 processor（change queue-monitoring：ops-alert「設定 Slack Webhook 時送到 Slack」
 * 「沒有設定管道時只記錄 log」「送出告警至少一次」）。
 *
 * fetch 換成記錄請求的假實作。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { logger } from '@open333crm/core';
import { createOpsAlertProcessor } from '#src/modules/ops-alert/ops-alert.worker.js';
import type { OpsAlertJob } from '#src/modules/ops-alert/ops-alert.service.js';

const WEBHOOK = 'https://hooks.slack.example/services/T/B/X';

const job = (data: Partial<OpsAlertJob> = {}) =>
  ({
    id: 'alert-1',
    data: {
      title: '佇列 job 重試用完',
      fields: { 佇列: 'event-webhook', 'job id': 'j1' },
      link: 'https://crm.example/api/v1/platform/queues',
      suppressedCount: 0,
      ...data,
    },
  }) as never;

function stubFetch(responses: Array<number | Error>) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    const next = responses.shift() ?? 200;
    if (next instanceof Error) throw next;
    return new Response('ok', { status: next });
  });
  return requests;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('送出一則告警', async () => {
  const requests = stubFetch([200]);

  await createOpsAlertProcessor(WEBHOOK)(job());

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, WEBHOOK);
  assert.equal(requests[0].init.method, 'POST');
  const body = String(requests[0].init.body);
  assert.match(body, /佇列 job 重試用完/);
  assert.match(body, /event-webhook/);
  assert.match(body, /j1/);
  assert.match(body, /https:\/\/crm\.example\/api\/v1\/platform\/queues/);
});

test('下一段期間的告警帶上次數：訊息寫明前一段期間另有幾次', async () => {
  const requests = stubFetch([200]);

  await createOpsAlertProcessor(WEBHOOK)(job({ suppressedCount: 49 }));

  assert.equal(requests.length, 1);
  assert.match(String(requests[0].init.body), /另有 49 次/);
});

test('沒有設定 Slack Webhook', async () => {
  const requests = stubFetch([]);
  const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

  await createOpsAlertProcessor(undefined)(job());
  await createOpsAlertProcessor('')(job());

  assert.equal(requests.length, 0);
  assert.equal(warn.mock.calls.length, 2);
  assert.match(String(warn.mock.calls[0][0]), /佇列 job 重試用完/);
});

test('Slack 暫時無法連線', async () => {
  const requests = stubFetch([new Error('ECONNRESET'), 200]);
  const process = createOpsAlertProcessor(WEBHOOK);

  // 第 1 次失敗時 processor 丟錯，由佇列重試；第 2 次成功
  await assert.rejects(process(job()), /ECONNRESET/);
  await process(job());

  assert.equal(requests.length, 2);
});

test('Slack 回應非 2xx 時 processor 丟錯，由佇列重試', async () => {
  stubFetch([500]);

  await assert.rejects(createOpsAlertProcessor(WEBHOOK)(job()), /500/);
});
