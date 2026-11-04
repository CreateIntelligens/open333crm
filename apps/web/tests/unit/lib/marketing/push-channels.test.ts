/**
 * 群發頁與券詳情批次發券的渠道選單只列能主動推送的渠道（change reject-webchat-push-415，issue #415）。
 * 修正前群發頁只過濾啟用中，網站聊天室也列出，送出後回報成功、顧客卻收不到。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { activePushChannels } from '#src/lib/marketing/coupon-broadcast.js';

const channels = [
  { id: 'line', channelType: 'LINE', isActive: true },
  { id: 'web', channelType: 'WEBCHAT', isActive: true },
  { id: 'fb', channelType: 'FB', isActive: true },
  { id: 'ig', channelType: 'THREADS', isActive: true },
  { id: 'line-off', channelType: 'LINE', isActive: false },
];

test('群發頁的渠道選單：只有啟用中、能主動推送的渠道', () => {
  assert.deepEqual(activePushChannels(channels).map((c) => c.id), ['line', 'fb', 'ig']);
});

test('群發頁的渠道選單：只有網站聊天室時沒有選項', () => {
  assert.deepEqual(activePushChannels([{ id: 'web', channelType: 'WEBCHAT', isActive: true }]), []);
});
