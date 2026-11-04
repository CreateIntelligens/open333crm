/**
 * LINE 外掛的 `flex` 訊息與不認得的 contentType（issue #416，change fix-csat-line-flex-416）。
 *
 * 滿意度問卷以 `contentType: 'flex'` 送出，但 buildLineMessage() 沒有 `flex` 分支，
 * 落到 default 變成空白文字 `{"type":"text","text":""}`，LINE 拒收。
 * 不認得的 contentType 也不可再悄悄變成空白文字，要回失敗並帶原因。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { buildLineMessage, linePlugin } from '#src/line/index.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const BUBBLE = {
  type: 'bubble',
  body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '滿意度調查' }] },
};

function captureFetch() {
  const bodies: Array<{ messages: Array<Record<string, unknown>> }> = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return bodies;
}

test('Flex message sent：buildLineMessage(flex) 回傳 type flex、altText 與 contents', () => {
  const msg = buildLineMessage('flex', { type: 'flex', altText: '請評價此次服務', contents: BUBBLE }) as Record<string, unknown>;

  assert.equal(msg.type, 'flex');
  assert.equal(msg.altText, '請評價此次服務');
  assert.deepEqual(msg.contents, BUBBLE);
});

test('Flex message sent：送出策略等內部欄位不送給 LINE', async () => {
  const bodies = captureFetch();

  const result = await linePlugin.sendMessage(
    'line-user-1',
    { contentType: 'flex', content: { type: 'flex', altText: '請評價', contents: BUBBLE, strategy: 'push' } },
    { channelAccessToken: 'token' },
  );

  assert.equal(result.success, true);
  assert.deepEqual(bodies[0].messages, [{ type: 'flex', altText: '請評價', contents: BUBBLE }]);
});

test('Flex message sent：舊資料的 flexJson 與 text 仍可送出', () => {
  const msg = buildLineMessage('flex', { text: '舊模板', flexJson: BUBBLE }) as Record<string, unknown>;

  assert.deepEqual(msg, { type: 'flex', altText: '舊模板', contents: BUBBLE });
});

test('Flex 訊息缺少 altText：不呼叫 LINE，回失敗並帶原因', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const result = await linePlugin.sendMessage(
    'line-user-1',
    { contentType: 'flex', content: { type: 'flex', contents: BUBBLE } },
    { channelAccessToken: 'token' },
  );

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /替代文字|altText/);
  assert.equal(calls, 0);
});

test('不認得的訊息類型：不呼叫 LINE，回失敗並帶原因', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const result = await linePlugin.sendMessage(
    'line-user-1',
    { contentType: 'fb_generic', content: { text: '' } },
    { channelAccessToken: 'token' },
  );

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /fb_generic/);
  assert.equal(calls, 0);
});

test('不認得的訊息類型：同次推送的附加訊息不認得時整批不送', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const result = await linePlugin.sendMessage(
    'line-user-1',
    { contentType: 'text', content: { text: '素材' }, extraMessages: [{ contentType: 'wut', content: { text: 'x' } }] },
    { channelAccessToken: 'token' },
  );

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /wut/);
  assert.equal(calls, 0);
});

test('Text message sent：text 與 quick_reply 照常送出', async () => {
  const bodies = captureFetch();

  await linePlugin.sendMessage('u', { contentType: 'text', content: { text: '你好' } }, { channelAccessToken: 't' });
  await linePlugin.sendMessage(
    'u',
    { contentType: 'quick_reply', content: { text: '請選擇', quickReplies: [{ label: '是', text: '是' }] } },
    { channelAccessToken: 't' },
  );

  assert.deepEqual(bodies[0].messages, [{ type: 'text', text: '你好' }]);
  assert.equal(bodies[1].messages[0].type, 'text');
  assert.equal(bodies[1].messages[0].text, '請選擇');
  assert.ok(bodies[1].messages[0].quickReply, '快速回覆按鈕保留');
});

for (const contentType of ['text', 'quick_reply']) {
  for (const [label, content] of [
    ['缺少文字', {}],
    ['空白文字', { text: '   ' }],
    ['文字不是字串', { text: 123 }],
  ] as const) {
    test(`文字訊息缺少內容（${contentType}，${label}）：不呼叫 LINE，回失敗並帶原因（PR #440 審查）`, async () => {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return new Response('{}', { status: 200 });
      }) as typeof fetch;

      const result = await linePlugin.sendMessage(
        'line-user-1',
        { contentType, content: content as Record<string, unknown> },
        { channelAccessToken: 'token' },
      );

      assert.equal(result.success, false);
      assert.match(result.error ?? '', /文字/);
      assert.equal(calls, 0);
    });
  }
}

for (const [label, content] of [
  ['缺少 packageId', { stickerId: '52002734' }],
  ['缺少 stickerId', { packageId: '11537' }],
  ['空白 stickerId', { packageId: '11537', stickerId: ' ' }],
] as const) {
  test(`貼圖缺少必要欄位（${label}）：不呼叫 LINE，回失敗並帶原因（PR #440 審查）`, async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const result = await linePlugin.sendMessage(
      'line-user-1',
      { contentType: 'sticker', content: content as Record<string, unknown> },
      { channelAccessToken: 'token' },
    );

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /貼圖/);
    assert.equal(calls, 0);
  });
}

test('貼圖有 packageId 與 stickerId：照常送出', () => {
  const msg = buildLineMessage('sticker', { packageId: '11537', stickerId: '52002734' }) as Record<string, unknown>;
  assert.deepEqual({ type: msg.type, packageId: msg.packageId, stickerId: msg.stickerId }, { type: 'sticker', packageId: '11537', stickerId: '52002734' });
});
