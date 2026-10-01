import assert from 'node:assert/strict';
import {
  consumeSocketSubscriptionAttempt,
  type SocketSubscriptionRateLimitState,
} from '../modules/socket/socket-subscription-rate-limit.js';

let state: SocketSubscriptionRateLimitState = { count: 0, resetAt: 60_000 };
for (let i = 0; i < 60; i += 1) {
  const result = consumeSocketSubscriptionAttempt(state, 1_000);
  state = result.state;
  assert.equal(result.allowed, true);
}

const blocked = consumeSocketSubscriptionAttempt(state, 1_000);
assert.equal(blocked.allowed, false);
assert.equal(blocked.state.count, 60);

const reset = consumeSocketSubscriptionAttempt(blocked.state, 60_000);
assert.equal(reset.allowed, true);
assert.equal(reset.state.count, 1);
assert.equal(reset.state.resetAt, 120_000);

console.log('socket subscription rate limit tests passed');
