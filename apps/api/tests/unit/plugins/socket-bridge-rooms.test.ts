/**
 * workers 經 Redis `socket:emit` 送來的推播目標（主規格 core-inbox「socket:emit Message Shape」）。
 * `rooms` 讓 workers 把渠道推播送到渠道房間與總店房間，不送到全租戶房間（issue #427）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { bridgeRooms } from '#src/plugins/socket.plugin.js';

test('room 字串：送到這一個房間', () => {
  assert.deepEqual(bridgeRooms({ room: 'tenant:t1' }), ['tenant:t1']);
});

test('rooms 陣列：送到這些房間', () => {
  assert.deepEqual(bridgeRooms({ rooms: ['tenant:t1:channel:c1', 'tenant:t1:channels:all'] }), ['tenant:t1:channel:c1', 'tenant:t1:channels:all']);
});

test('格式不符：沒有房間、空陣列、陣列含非字串都回 null（訊息被丟棄）', () => {
  assert.equal(bridgeRooms({}), null);
  assert.equal(bridgeRooms({ rooms: [] }), null);
  assert.equal(bridgeRooms({ rooms: ['tenant:t1', 3] }), null);
});

test('格式不符：同時給 room 與 rooms、空字串的房間名稱都回 null（PR #438 審查）', () => {
  assert.equal(bridgeRooms({ room: 'tenant:t1', rooms: ['tenant:t1:channel:c1'] }), null);
  assert.equal(bridgeRooms({ room: '' }), null);
  assert.equal(bridgeRooms({ rooms: [''] }), null);
  assert.equal(bridgeRooms({ rooms: ['tenant:t1', ''] }), null);
});
