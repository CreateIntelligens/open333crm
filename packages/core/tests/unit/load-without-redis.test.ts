/**
 * import @open333crm/core 不連 Redis，也不建立 BullMQ 的 Queue 與 Worker（#327）。
 *
 * 以前 redis/client.ts 在 import 時就連線，cases/case-service.ts 在 import 時建立
 * sla-monitoring 的 Queue 與 Worker（AUDIT APP-01）。每個 import core 的行程與測試檔都連到
 * Redis，只需要 logger 的程式也一樣。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

const bullmqCreated = vi.hoisted(() => [] as string[]);

vi.mock('bullmq', async (importOriginal) => {
  const original = await importOriginal<typeof import('bullmq')>();
  return {
    ...original,
    Queue: class {
      constructor(name: string) {
        bullmqCreated.push(`Queue ${name}`);
      }
    },
    Worker: class {
      constructor(name: string) {
        bullmqCreated.push(`Worker ${name}`);
      }
    },
  };
});

test('import core 後，redis 在第一次執行指令前不連線', async () => {
  const { redis } = await import('#src/index.js');
  assert.equal(redis.status, 'wait');
});

test('import core 時不建立 BullMQ 的 Queue 與 Worker', async () => {
  await import('#src/index.js');
  assert.deepEqual(bullmqCreated, []);
});
