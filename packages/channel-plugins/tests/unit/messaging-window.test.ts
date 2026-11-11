/**
 * 渠道訊息視窗（change broadcast-messaging-window，spec broadcast-audience
 * 「有訊息視窗的渠道只發給視窗內互動過的人」）。
 * Meta 只允許對 24 小時內互動過的人發一般訊息；LINE 沒有這個限制。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { FbPlugin, ThreadsPlugin, LinePlugin } from '#src/index.js';

test('FB 與 IG 的 plugin 宣告 24 小時視窗', () => {
  assert.equal(new FbPlugin().messagingWindowHours, 24);
  assert.equal(new ThreadsPlugin().messagingWindowHours, 24);
  assert.equal(new LinePlugin().messagingWindowHours, undefined);
});
