/**
 * 去識別化服務短暫故障時重試一次（issue #466，change fix-deid-inbound-fallback-466：
 * inbound-message-processing「去識別化服務短暫故障時重試一次」）。只替換 global fetch。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { prepareInboundMessageContent } from '#src/modules/ai/deidentification.service.js';

const policy = { enabled: true };
const ok = (text: string) => Response.json({ code: 200, data: { status: 'ok', text: text.replace('0912345678', '[手機]') } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('去識別化服務回 400 不重試', async () => {
  const fetchMock = vi.fn(async () => new Response('bad', { status: 400 }));
  vi.stubGlobal('fetch', fetchMock);
  const prepared = await prepareInboundMessageContent(policy, { text: '我的電話 0912345678' });
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(prepared.unmaskedReason, 'upstream_rejected');
  assert.deepEqual(prepared.metadata, { privacy: { version: 1, mode: 'inbound_unmasked', reason: 'upstream_rejected' } });
  assert.deepEqual(prepared.content, { text: '我的電話 0912345678' });
});

test('逾時之後重試一次成功', async () => {
  vi.useFakeTimers();
  let attempt = 0;
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    attempt += 1;
    if (attempt === 1) {
      // 第一次不回應，直到逾時中止
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    return Promise.resolve(ok(JSON.parse(String(init.body)).text));
  });
  vi.stubGlobal('fetch', fetchMock);
  const pending = prepareInboundMessageContent(policy, { text: '我的電話 0912345678' });
  await vi.advanceTimersByTimeAsync(6_000);
  assert.equal(fetchMock.mock.calls.length, 1, '6 秒時第一次逾時，還在等待重試');
  await vi.advanceTimersByTimeAsync(400);
  const prepared = await pending;
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(prepared.unmaskedReason, undefined);
  assert.deepEqual((prepared.metadata as { privacy: { maskedContent: unknown } }).privacy.maskedContent, { text: '我的電話 [手機]' });
});

test('兩次都逾時', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  vi.stubGlobal('fetch', fetchMock);
  const pending = prepareInboundMessageContent(policy, { text: '我的電話 0912345678' });
  await vi.advanceTimersByTimeAsync(12_400);
  const prepared = await pending;
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(prepared.unmaskedReason, 'timeout');
});

test('遮罩政策關閉時不呼叫去識別化服務', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const prepared = await prepareInboundMessageContent({ enabled: false }, { text: 'hi' });
  assert.deepEqual(prepared, { content: { text: 'hi' }, metadata: {} });
  assert.equal(fetchMock.mock.calls.length, 0);
});
