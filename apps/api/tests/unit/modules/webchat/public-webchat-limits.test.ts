import assert from 'node:assert/strict';
import {
  consumePublicWebchatLimit,
  getPublicWebchatKey,
  resetPublicWebchatLimits,
} from '../modules/webchat/public-webchat-limits.js';

resetPublicWebchatLimits();

const secret = 'cb2.secret-session-material';
const key = getPublicWebchatKey('session', secret);
assert.notEqual(key, secret);
assert.equal(key.includes(secret), false);

const first = consumePublicWebchatLimit(key, 2, 1_000, 60_000);
const second = consumePublicWebchatLimit(key, 2, 1_000, 60_000);
const rejected = consumePublicWebchatLimit(key, 2, 1_000, 60_000);
assert.equal(first.allowed, true);
assert.equal(second.allowed, true);
assert.equal(rejected.allowed, false);
assert.equal(rejected.retryAfterSeconds, 60);

const afterWindow = consumePublicWebchatLimit(key, 2, 61_000, 60_000);
assert.equal(afterWindow.allowed, true);

console.log('public webchat limit tests passed');
