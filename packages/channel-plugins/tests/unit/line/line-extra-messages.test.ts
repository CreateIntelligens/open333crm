/**
 * 附券廣播的素材與發券文字以同一次推送送出（add-coupon-system design D29）：
 * LINE 的兩則同時成功或失敗，不會出現「素材送達、連結沒送到」。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { linePlugin } from '#src/line/index.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('LINE 的素材與發券文字以同一次推送送出', async () => {
  const bodies: Array<{ to: string; messages: Array<{ type: string; text?: string }> }> = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const result = await linePlugin.sendMessage(
    'line-user-1',
    {
      contentType: 'text',
      content: { text: '秋季優惠開跑' },
      extraMessages: [{ contentType: 'text', content: { text: '為您準備了一張優惠券' } }],
    },
    { channelAccessToken: 'token' },
  );

  assert.equal(result.success, true);
  assert.equal(bodies.length, 1, '只呼叫一次推送');
  assert.deepEqual(bodies[0].messages.map((m) => m.text), ['秋季優惠開跑', '為您準備了一張優惠券']);
  assert.equal(linePlugin.maxMessagesPerSend, 5);
});

test('超過一次 5 則時不呼叫 LINE，回報錯誤（PR #364 審查）', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const result = await linePlugin.sendMessage(
    'line-user-1',
    {
      contentType: 'text',
      content: { text: '第 1 則' },
      extraMessages: Array.from({ length: 5 }, (_, i) => ({ contentType: 'text', content: { text: `第 ${i + 2} 則` } })),
    },
    { channelAccessToken: 'token' },
  );

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /5/);
  assert.equal(calls, 0, '整批會被 LINE 拒收，不送出');
});
