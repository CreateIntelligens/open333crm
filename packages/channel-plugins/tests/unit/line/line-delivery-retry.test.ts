import assert from 'node:assert/strict';
import { linePlugin } from '../line/index.js';

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function main() {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];

  try {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return response(200, {}, { 'x-line-request-id': 'request-1' });
    }) as typeof fetch;

    const first = await linePlugin.sendMessage(
      'line-user-1',
      {
        contentType: 'text',
        content: { text: 'retry-safe' },
        delivery: { retryKey: '00000000-0000-0000-0000-000000000001' },
      },
      { channelAccessToken: 'token' },
    );
    const second = await linePlugin.sendMessage(
      'line-user-1',
      {
        contentType: 'text',
        content: { text: 'retry-safe' },
        delivery: { retryKey: '00000000-0000-0000-0000-000000000001' },
      },
      { channelAccessToken: 'token' },
    );

    assert.equal(first.requestId, 'request-1');
    assert.equal(second.requestId, 'request-1');
    assert.equal(requests[0].headers.get('x-line-retry-key'), '00000000-0000-0000-0000-000000000001');
    assert.deepEqual(requests[0].body, requests[1].body);

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(_url), headers: new Headers(init?.headers), body: undefined });
      return response(409, { message: 'The retry key is already accepted' }, {
        'x-line-request-id': 'retry-request',
        'x-line-accepted-request-id': 'accepted-request',
      });
    }) as typeof fetch;

    const accepted = await linePlugin.sendMessage(
      'line-user-1',
      {
        contentType: 'text',
        content: { text: 'retry-safe' },
        delivery: { retryKey: '00000000-0000-0000-0000-000000000001' },
      },
      { channelAccessToken: 'token' },
    );
    assert.equal(accepted.success, true);
    assert.equal(accepted.requestId, 'accepted-request');

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(_url), headers: new Headers(init?.headers), body: undefined });
      return response(500, { message: 'temporary upstream failure' }, {
        'x-line-request-id': 'failed-request',
      });
    }) as typeof fetch;
    const failed = await linePlugin.sendMessage(
      'line-user-1',
      {
        contentType: 'text',
        content: { text: 'retry-safe' },
        delivery: { retryKey: '00000000-0000-0000-0000-000000000001' },
      },
      { channelAccessToken: 'token' },
    );
    assert.equal(failed.success, false);
    assert.match(failed.error ?? '', /LINE API error: 500/);

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(_url), headers: new Headers(init?.headers), body: undefined });
      return response(200, {}, { 'x-line-request-id': 'reply-request' });
    }) as typeof fetch;
    await linePlugin.sendMessage(
      'line-user-1',
      {
        contentType: 'text',
        content: { text: 'reply', strategy: 'reply', replyToken: 'reply-token' },
        delivery: { strategy: 'reply', retryKey: '00000000-0000-0000-0000-000000000001' },
      },
      { channelAccessToken: 'token' },
    );
    assert.equal(requests.at(-1)?.headers.get('x-line-retry-key'), null);

    console.log('line-delivery-retry.test.ts passed');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
