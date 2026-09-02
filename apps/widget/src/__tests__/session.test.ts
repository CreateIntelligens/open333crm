import assert from 'node:assert/strict';
import { initSession } from '../session.js';

const fingerprint = {
  browserFamily: 'chrome',
  osFamily: 'macos',
  language: 'zh-TW',
  timezone: 'Asia/Taipei',
  screenBucket: 'lg',
};

const requests: Array<{ url: string; init?: RequestInit }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  requests.push({ url, init });

  if (url.endsWith('/chatbox/sessions')) {
    return new Response(JSON.stringify({
      data: {
        sessionId: 'session-id',
        config: { greeting: null, theme: {} },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    data: {
      claimToken: 'claim-token',
      session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
      config: {
        greeting: 'Hello',
        theme: { backgroundSize: 'cover' },
      },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

(async () => {
  const result = await initSession('https://crm.example/api/v1', 'ch_public', fingerprint);

  assert.equal(result.sessionId, 'session-id');
  assert.equal(result.claimToken, 'claim-token');
  assert.equal(result.greeting, 'Hello');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://crm.example/api/v1/chatbox/sessions');
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    channel: 'ch_public',
    fingerprint,
  });
  assert.equal(requests[1].url, 'https://crm.example/api/v1/chatbox/sessions/verify');
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), {
    sessionId: 'session-id',
    fingerprint,
  });

  console.log('widget session tests passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
