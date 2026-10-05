/**
 * 收件匣收到 message.new 時重新抓訊息。原本的 debounce 只在開頭執行，500 ms 內的第二個事件直接丟掉：
 * 媒體下載完成後的第二個 message.new 常在 500 ms 內抵達，語音或檔案就一直停在文字。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { createTrailingThrottle } from '#src/lib/trailing-throttle.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('Download finishes right after the message arrives：間隔內的呼叫不丟掉，間隔結束後再執行一次', () => {
  let calls = 0;
  const run = createTrailingThrottle(() => (calls += 1), 500);
  run();
  assert.equal(calls, 1, '第一次立即執行');
  vi.advanceTimersByTime(300);
  run();
  run();
  assert.equal(calls, 1, '間隔內不立即執行');
  vi.advanceTimersByTime(200);
  assert.equal(calls, 2, '間隔結束後補執行一次，多次呼叫合併');
  vi.advanceTimersByTime(1000);
  assert.equal(calls, 2);
});

test('間隔外的呼叫立即執行', () => {
  let calls = 0;
  const run = createTrailingThrottle(() => (calls += 1), 500);
  run();
  vi.advanceTimersByTime(600);
  run();
  assert.equal(calls, 2);
});

test('cancel 取消尚未執行的補呼叫（元件卸載時用）', () => {
  let calls = 0;
  const run = createTrailingThrottle(() => (calls += 1), 500);
  run();
  run();
  run.cancel();
  vi.advanceTimersByTime(1000);
  assert.equal(calls, 1);
});
