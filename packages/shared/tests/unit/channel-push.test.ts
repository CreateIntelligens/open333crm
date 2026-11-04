/**
 * 能主動推送訊息的渠道（change reject-webchat-push-415，issue #415）：
 * 群發、附券廣播與批次發券只能用這些渠道；網站聊天室沒有主動推送。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { PROACTIVE_PUSH_CHANNEL_TYPES, supportsProactivePush } from '#src/constants/channel-push.js';

test('LINE、Facebook、Instagram 可以主動推送', () => {
  for (const type of ['LINE', 'FB', 'THREADS']) assert.equal(supportsProactivePush(type), true, type);
  assert.deepEqual([...PROACTIVE_PUSH_CHANNEL_TYPES].sort(), ['FB', 'LINE', 'THREADS']);
});

test('網站聊天室不能主動推送', () => {
  assert.equal(supportsProactivePush('WEBCHAT'), false);
});

test('沒有渠道類型或不認得的類型視為不能推送', () => {
  assert.equal(supportsProactivePush(undefined), false);
  assert.equal(supportsProactivePush('UNKNOWN'), false);
});
