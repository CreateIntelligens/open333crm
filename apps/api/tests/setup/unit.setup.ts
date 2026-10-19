/**
 * unit 測試的共用設定：不連 Redis（#299、#327）。
 *
 * ioredis 換成假的：建立時不連線，每個指令都立刻失敗，和 Redis 斷線時一樣。
 * 各服務在 Redis 失敗時都會退回資料庫或略過快取，所以 unit 測試照常執行。
 * `@open333crm/core` 的 `redis` 也用同一個 ioredis，這個 mock 一樣套用到它。
 *
 * 要測 Redis 的行為時，在測試檔自己 vi.mock('ioredis')，會蓋過這裡的設定。
 * 自己的 mock 也會套用到 core 的 `redis`，core 載入時會呼叫 `on()`，所以假的類別要有 `on()`。
 */
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

// repo 只裝一個版本的 ioredis（#327）。出現第二個版本時，core 會解析到另一個路徑，這個 mock 就套用不到 core。
vi.mock('ioredis', () => ({ default: FakeRedis, Redis: FakeRedis }));
