/**
 * EventBus 的訂閱連線（change unify-redis-connection-api：design D3）。
 *
 * core 的 `redis` 是一般用途的連線，有 commandTimeout。訂閱連線如果複製它，Redis 在啟動時無法使用的話，
 * SUBSCRIBE 會在時限後失敗，canvas 的事件訂閱就消失了。這裡檢查訂閱連線的設定：要讓 Redis 先無法使用、
 * 之後恢復，unit 測試做不到。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { EventBus } from '#src/event-bus/event-bus.js';

test('EventBus 的訂閱連線不限制等待時間（BullMQ 與訂閱用途）', () => {
  const sub = EventBus.subscribe(() => undefined);
  try {
    assert.equal(sub.options.commandTimeout, undefined);
    assert.equal(sub.options.maxRetriesPerRequest, null);
  } finally {
    sub.disconnect();
  }
});
