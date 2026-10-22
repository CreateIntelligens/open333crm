/**
 * 佇列監控列出的佇列（change queue-monitoring：queue-monitoring「列出所有佇列」）。
 *
 * workers 行程的 Worker 在 apps/workers/src/index.ts 建立，API 行程的 Worker 是 index.ts 傳給
 * startQueueWorkers() 的佇列與 api-scheduler。兩處都讀原始碼核對：新增 Worker 而沒有加進監控清單時，這裡失敗。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, vi } from 'vitest';
import { apiSrc, repoRoot } from '../../../support/paths.js';

const queues = vi.hoisted(() => [] as string[]);
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bullmq')>()),
  Queue: class {
    constructor(readonly name: string) {
      queues.push(name);
    }
    async close() {}
  },
}));

import {
  API_QUEUES,
  createMonitoredQueues,
  MONITORED_QUEUES,
  WORKERS_QUEUES,
} from '#src/modules/queue-monitoring/monitored-queues.js';

const sorted = (list: readonly string[]) => [...list].sort();

test('列出 workers 行程的佇列', async () => {
  const created = createMonitoredQueues('redis://localhost:6379');

  const names = created.map((q) => q.name);
  for (const name of ['notification', 'automation', 'event-automation', 'api-scheduler']) {
    assert.ok(names.includes(name), `監控清單缺少 ${name}`);
  }
  assert.deepEqual(sorted(names), sorted(MONITORED_QUEUES));
});

test('workers 行程的每個 Worker 都在監控清單內', () => {
  const source = readFileSync(join(repoRoot, 'apps/workers/src/index.ts'), 'utf8');
  const workerQueues = [...source.matchAll(/new Worker\(\s*'([^']+)'/g)].map((m) => m[1]);

  assert.ok(workerQueues.length > 0, '找不到 workers 的 Worker');
  assert.deepEqual(sorted(WORKERS_QUEUES), sorted(workerQueues));
});

test('API 行程的每個 Worker 都在監控清單內', async () => {
  const source = readFileSync(join(apiSrc, 'index.ts'), 'utf8');
  const block = source.match(/startQueueWorkers\(\s*\{([\s\S]*?)\n\s*\},/)?.[1] ?? '';
  const constants = [...block.matchAll(/\[([A-Z_]+)\]\s*:/g)].map((m) => m[1]);
  assert.ok(constants.length > 0, '找不到 startQueueWorkers() 的佇列');

  const core = await import('@open333crm/core');
  const opsAlert = await import('#src/modules/ops-alert/ops-alert.service.js');
  const values = { ...core, ...opsAlert } as Record<string, unknown>;
  const apiWorkerQueues = constants.map((name) => values[name]);

  assert.deepEqual(sorted(API_QUEUES), sorted([...apiWorkerQueues as string[], 'api-scheduler']));
});
