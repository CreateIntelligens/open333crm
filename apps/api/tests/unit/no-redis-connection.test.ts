/**
 * unit 測試不連 Redis（#299）。
 *
 * @open333crm/core 的 redis 在 import 時就建立連線。unit 測試以前會連到本機的 Redis：
 * 有開 dev 堆疊時讀寫 dev 的 Redis，沒開時一直重試。連線與錯誤的 log 在測試檔結束後才送出，
 * vitest 因此回報 EnvironmentTeardownError，所有測試都通過，pnpm test 仍然 exit 1。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { redis } from '@open333crm/core';

test('unit 測試裡，redis 的指令立刻失敗，不連到真的 Redis', async () => {
  await assert.rejects(redis.get('unit-test:no-redis'), /unit 測試不連 Redis/);
});

test('unit 測試裡，關閉 redis 的 quit()、end() 照常完成，不留下未處理的錯誤', async () => {
  assert.equal(await redis.quit(), 'OK');
  redis.end();
});
