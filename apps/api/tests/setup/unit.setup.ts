/**
 * unit 測試的共用設定：不連 Redis（#299）。
 *
 * - ioredis 換成假的：建立時不連線，每個指令都立刻失敗，和 Redis 斷線時一樣。
 *   各服務在 Redis 失敗時都會退回資料庫或略過快取，所以 unit 測試照常執行。
 * - bullmq 的 Queue、Worker 換成不做事的物件：`add()` 回傳假的 job，Worker 不取 job。
 *   `@open333crm/core` 在 import 時就建立 `sla-monitoring` 的 Queue 與 Worker（AUDIT APP-01），
 *   用真的 bullmq 會連到 Redis。
 *
 * 要測 Redis 或 bullmq 的行為時，在測試檔自己 vi.mock，會蓋過這裡的設定。
 */
import { createRequire } from 'node:module';
import { vi } from 'vitest';

const EVENT_METHODS = new Set(['on', 'once', 'off', 'addListener', 'removeListener', 'removeAllListeners']);

function createFakeRedis(): object {
  const fake: object = new Proxy(
    {},
    {
      get(_target, prop) {
        // 不是 thenable，await 這個物件時不會被當成 Promise
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (prop === 'status') return 'end';
        if (EVENT_METHODS.has(prop)) return () => fake;
        if (prop === 'duplicate') return () => createFakeRedis();
        // 關閉連線不算指令：Redis 斷線時關閉也不會失敗，失敗反而會在測試結束時留下未處理的錯誤
        if (prop === 'disconnect' || prop === 'end') return () => undefined;
        if (prop === 'quit') return async () => 'OK';
        // 其餘都當成 Redis 指令
        return () => Promise.reject(new Error('unit 測試不連 Redis'));
      },
    },
  );
  return fake;
}

class FakeRedis {
  constructor() {
    return createFakeRedis();
  }
}

function createInertBullObject(): object {
  const inert: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (EVENT_METHODS.has(prop)) return () => inert;
        if (prop === 'add') return async (name: string) => ({ id: 'unit-test-job', name });
        return async () => undefined;
      },
    },
  );
  return inert;
}

class InertBullClass {
  constructor() {
    return createInertBullObject();
  }
}

// api 與 @open333crm/core 各自相依的版本可能不同，解析到不同的路徑，兩個都要 mock。
// core 要在 vitest.config.ts 設成 inline，它的 import 才經過 vitest 的 mock。
const fromApi = createRequire(import.meta.url);
const fromCore = createRequire(fromApi.resolve('@open333crm/core'));
for (const path of new Set([fromApi.resolve('ioredis'), fromCore.resolve('ioredis')])) {
  vi.doMock(path, () => ({ default: FakeRedis, Redis: FakeRedis }));
}
for (const path of new Set([fromApi.resolve('bullmq'), fromCore.resolve('bullmq')])) {
  vi.doMock(path, async (importOriginal) => ({
    ...(await importOriginal<object>()),
    Queue: InertBullClass,
    Worker: InertBullClass,
    QueueEvents: InertBullClass,
  }));
}
