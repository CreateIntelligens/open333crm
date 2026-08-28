import assert from 'node:assert/strict';
import { LINE_REPLY_SAFE_WINDOW_MS, selectSafeLineStrategy } from '@open333crm/shared';

const receivedAt = new Date('2026-08-28T00:00:00.000Z');
assert.equal(selectSafeLineStrategy({ replyToken: 'reply-1', receivedAt, now: new Date(receivedAt.getTime() + LINE_REPLY_SAFE_WINDOW_MS - 1) }), 'reply');
assert.equal(selectSafeLineStrategy({ replyToken: 'reply-1', receivedAt, now: new Date(receivedAt.getTime() + LINE_REPLY_SAFE_WINDOW_MS) }), 'push');
assert.equal(selectSafeLineStrategy({ replyToken: 'reply-1', receivedAt: 'not-a-date', now: receivedAt }), 'push');
assert.equal(selectSafeLineStrategy({ receivedAt, now: receivedAt }), 'push');
console.log('safe-reply tests passed');
