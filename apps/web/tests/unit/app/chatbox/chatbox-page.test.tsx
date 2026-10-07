// @vitest-environment jsdom
/**
 * `/chatbox` 頁面以 sessionId 的生命週期運作，不用訪客 token
 * （openspec/specs/webchat-widget「Chatbox mode uses session id instead of visitor token」）。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const io = vi.hoisted(() => vi.fn(() => ({ on: vi.fn(), disconnect: vi.fn() })));
vi.mock('socket.io-client', () => ({ io }));
vi.mock('#src/lib/constants.js', () => ({
  API_BASE_URL: 'https://crm.example/api/v1',
  REALTIME_ORIGIN: 'https://crm.example',
}));

import ChatboxPage from '#src/app/chatbox/page.js';

test('Chatbox mode uses session id instead of visitor token：claim 網址的 sessionId，以 sessionId 與 claim token 連線，不建立訪客 token', async () => {
  const requests: Array<{ url: string; body: string }> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: String(init?.body ?? '') });
    return new Response(JSON.stringify({
      data: {
        claimToken: 'claim-1',
        session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
        config: { channelId: 'channel-1', displayName: 'Support', greeting: null, theme: {} },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  window.history.replaceState(null, '', '/chatbox?sessionId=cb2.session-from-url');

  const { unmount } = render(<ChatboxPage />);
  await waitFor(() => assert.equal(io.mock.calls.length, 1));

  assert.deepEqual(requests.map((request) => request.url), ['https://crm.example/api/v1/chatbox/sessions/verify']);
  assert.equal(JSON.parse(requests[0]!.body).sessionId, 'cb2.session-from-url');
  const [url, options] = io.mock.calls[0] as unknown as [string, { auth: Record<string, unknown> }];
  assert.equal(url, 'https://crm.example/visitor');
  assert.equal(options.auth.sessionId, 'cb2.session-from-url');
  assert.equal(options.auth.claimToken, 'claim-1');
  assert.equal('visitorToken' in options.auth, false);
  assert.equal(requests.some((request) => request.body.includes('visitorToken')), false);
  assert.equal(sessionStorage.getItem('open333crm_visitor'), null);
  assert.equal(localStorage.getItem('open333crm_visitor'), null);
  unmount();
});
