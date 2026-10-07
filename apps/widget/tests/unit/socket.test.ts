/** widget 以 claim 過的工作階段連線訪客 socket（主規格 webchat-widget） */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

const io = vi.hoisted(() => vi.fn(() => ({ on: vi.fn(), disconnect: vi.fn() })));
vi.mock('socket.io-client', () => ({ io }));

import { connectVisitorSocket } from '#src/socket.js';

test('Widget connects with the claimed session：以 sessionId 與 claimToken 連線 /visitor，不送 visitorToken', () => {
  const fingerprint = { browserFamily: 'chrome', osFamily: 'macos' };

  connectVisitorSocket('https://crm.example', 'session-1', 'claim-1', fingerprint);

  assert.equal(io.mock.calls.length, 1);
  const [url, options] = io.mock.calls[0] as unknown as [string, { auth: Record<string, unknown> }];
  assert.equal(url, 'https://crm.example/visitor');
  assert.deepEqual(options.auth, { sessionId: 'session-1', claimToken: 'claim-1', fingerprint });
});
