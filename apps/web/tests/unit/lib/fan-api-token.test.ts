// @vitest-environment jsdom
/**
 * 顧客憑證：瀏覽器封鎖 sessionStorage 時，這次瀏覽仍要能用（存在記憶體）。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { getFanToken, setFanToken } from '#src/lib/fan-api.js';

afterEach(() => {
  vi.restoreAllMocks();
  setFanToken(null);
});

test('sessionStorage 被封鎖：憑證存在記憶體，同一頁仍讀得到', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
  setFanToken('fan-jwt');
  assert.equal(getFanToken(), 'fan-jwt');
});

test('清除後讀不到', () => {
  setFanToken('fan-jwt');
  setFanToken(null);
  assert.equal(getFanToken(), null);
});
