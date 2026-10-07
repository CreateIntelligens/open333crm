/**
 * AUDIT CHAN-03：三個外掛的 webhook 驗簽。
 * - 簽章以固定時間比較（timingSafeEqual），不以 === 比對。
 * - 簽章長度不同時回傳 false，不拋出錯誤。
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { beforeEach, test, vi } from 'vitest';

const timingCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const timingSafeEqual: typeof actual.timingSafeEqual = (a, b) => {
    timingCalls.count += 1;
    return actual.timingSafeEqual(a, b);
  };
  return { ...actual, default: { ...actual, timingSafeEqual }, timingSafeEqual };
});

const { LinePlugin } = await import('#src/line/index.js');
const { FbPlugin } = await import('#src/facebook/index.js');
const { ThreadsPlugin } = await import('#src/threads.js');

const SECRET = 'test-secret';
const body = Buffer.from(JSON.stringify({ events: [] }));
const hex = createHmac('sha256', SECRET).update(body).digest('hex');
const b64 = createHmac('sha256', SECRET).update(body).digest('base64');
/** 同長度但內容不同的簽章 */
const flip = (s: string) => (s[0] === 'a' ? 'b' : 'a') + s.slice(1);

/** 拋錯也記錄成結果，讓「拋錯」以斷言失敗呈現 */
function verify(fn: () => boolean): boolean | 'threw' {
  try { return fn(); } catch { return 'threw'; }
}

const cases = [
  { name: 'LINE', plugin: new LinePlugin(), header: 'x-line-signature', valid: b64 },
  { name: 'Facebook', plugin: new FbPlugin(), header: 'x-hub-signature-256', valid: `sha256=${hex}` },
  { name: 'Instagram', plugin: new ThreadsPlugin(), header: 'x-hub-signature-256', valid: `sha256=${hex}` },
] as const;

beforeEach(() => { timingCalls.count = 0; });

for (const c of cases) {
  test(`${c.name}：正確的簽章通過，並以固定時間比較`, () => {
    assert.equal(verify(() => c.plugin.verifySignature(body, { [c.header]: c.valid }, SECRET)), true);
    assert.ok(timingCalls.count > 0, '應以 timingSafeEqual 比對簽章');
  });

  test(`${c.name}：同長度但錯誤的簽章回傳 false`, () => {
    assert.equal(verify(() => c.plugin.verifySignature(body, { [c.header]: flip(c.valid) }, SECRET)), false);
  });

  test(`${c.name}：長度不同的簽章回傳 false，不拋出錯誤`, () => {
    assert.equal(verify(() => c.plugin.verifySignature(body, { [c.header]: c.valid.slice(0, -4) }, SECRET)), false);
  });

  test(`${c.name}：缺少簽章回傳 false`, () => {
    assert.equal(verify(() => c.plugin.verifySignature(body, {}, SECRET)), false);
  });
}
